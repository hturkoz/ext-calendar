/************************************************************************
 * This file is for EspoCRM.
 *
 * EspoCRM – Open Source CRM application.
 * Copyright (C) 2014-2026 EspoCRM, Inc.
 * Website: https://www.espocrm.com
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * The interactive user interfaces in modified source and object code versions
 * of this program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU Affero General Public License version 3.
 *
 * In accordance with Section 7(b) of the GNU Affero General Public License version 3,
 * these Appropriate Legal Notices must retain the display of the "EspoCRM" word.
 ************************************************************************/

/** @module ext-calendar:views/calendar/calendar */

import Datepicker from 'ui/datepicker';
import CalendarView from 'crm:views/calendar/calendar';
import CalendarPreferences from 'ext-calendar:helpers/calendar-preferences';
import CalendarNormalizer from 'ext-calendar:helpers/calendar-normalizer';
import PdfPrinter from 'ext-calendar:helpers/pdf-printer';

/**
 * Extended calendar view.
 *
 * Adds print support, a date picker, per-user slot/weekend preferences,
 * an inline edit pencil on events and custom handling for "all-day" scopes
 * that actually have start/end times on the same day.
 */
export default class extends CalendarView {

    /**
     * @type {string}
     */
    template = 'ext-calendar:calendar/calendar';

    /**
     * Whether slot / weekend preferences have already been applied
     * to the underlying calendar instance.
     *
     * @private
     * @type {boolean}
     */
    preferencesApplied = false;

    /**
     * Whether the date picker is currently being updated programmatically.
     * Used to avoid feedback loops between the picker and the calendar.
     *
     * @private
     * @type {boolean}
     */
    updatingPicker = false;

    /**
     * Sets up the view: initializes preferences and binds custom event handlers.
     *
     * @returns {void}
     */
    setup() {
        super.setup();

        this.prefs = new CalendarPreferences(this.getPreferences());

        this.events = {
            ...this.events,
            'click button[data-action="print"]': () => this.actionPrint(),
        };
    }

    /**
     * Called after the view is rendered.
     * Resets the preferences flag and initializes the date picker.
     *
     * @returns {void}
     */
    afterRender() {
        this.preferencesApplied = false;

        super.afterRender();

        this.initDatePicker();
    }

    /**
     * Called by the core right after the calendar is created and rendered.
     * Applies user preferences, then delegates to the parent implementation.
     *
     * @param {...*} args - Forwarded to the parent `handleScrollToNow`.
     * @returns {*}
     */
    handleScrollToNow(...args) {
        this.applyPreferences();

        return super.handleScrollToNow(...args);
    }

    /**
     * Applies user preferences (weekends, slot range, eventChange handler,
     * eventDidMount wrapper) to the calendar. Runs only once per render.
     *
     * @private
     * @returns {void}
     */
    applyPreferences() {
        if (this.preferencesApplied || !this.calendar) {
            return;
        }

        this.preferencesApplied = true;

        this.calendar.setOption('weekends', this.prefs.showWeekends);

        const minTime = this.prefs.getSlotMinTime();
        const maxTime = this.prefs.getSlotMaxTime();

        if (minTime && maxTime) {
            this.calendar.setOption('slotMinTime', minTime);
            this.calendar.setOption('slotMaxTime', maxTime);
        }

        this.calendar.setOption('eventChange', info => this.handleEventChange(info));

        // Chain with the core handler if any, so it is not overwritten.
        const previousDidMount = this.calendar.getOption('eventDidMount');

        this.calendar.setOption('eventDidMount', info => {
            if (previousDidMount) {
                previousDidMount(info);
            }

            this.addEditButton(info);
        });
    }

    /**
     * Adds a small pencil icon at the bottom-right corner of an event.
     * Clicking it opens the edit modal directly.
     *
     * @private
     * @param {{event: Object, el: HTMLElement, view: Object}} info - FullCalendar event info.
     * @returns {void}
     */
    addEditButton(info) {
        const props = info.event.extendedProps || {};
        const scope = props.scope;
        const recordId = props.recordId;

        // Skip background events (non-working ranges) and list views.
        if (!scope || !recordId || info.view.type.startsWith('list')) {
            return;
        }

        if (!this.getAcl().checkScope(scope, 'edit')) {
            return;
        }

        if (info.el.querySelector('.ext-calendar-edit-btn')) {
            return;
        }

        const btn = document.createElement('span');

        btn.className = 'ext-calendar-edit-btn fas fa-pencil-alt';
        btn.title = this.translate('Edit');

        Object.assign(btn.style, {
            position: 'absolute',
            right: '2px',
            bottom: '2px',
            zIndex: '5',
            padding: '2px 3px',
            fontSize: '10px',
            lineHeight: '1',
            borderRadius: '3px',
            //background: 'rgba(255, 255, 255, 0.35)',
            color: 'inherit',
            cursor: 'pointer',
        });

        // Visible on hover with a mouse, always visible on touch devices.
        const hoverable = window.matchMedia('(hover: hover)').matches;

        btn.style.opacity = hoverable ? '0' : '0.8';

        if (hoverable) {
            info.el.addEventListener('mouseenter', () => btn.style.opacity = '1');
            info.el.addEventListener('mouseleave', () => btn.style.opacity = '0');
        }

        // Prevent FullCalendar from starting a drag or opening the detail view.
        ['mousedown', 'touchstart'].forEach(type => {
            btn.addEventListener(type, e => e.stopPropagation());
        });

        btn.addEventListener('click', e => {
            e.stopPropagation();
            e.preventDefault();

            this.openEditModal(scope, recordId);
        });

        info.el.appendChild(btn);
    }

    /**
     * Opens the edit modal for the given record.
     * Refetches calendar events once saved, so a Task whose dates changed
     * gets placed back correctly (grid or "all-day" row) via `handleAllDay`.
     *
     * @private
     * @param {string} scope
     * @param {string} id
     * @returns {Promise<void>}
     */
    async openEditModal(scope, id) {
        const viewName = this.getMetadata().get(['clientDefs', scope, 'modalViews', 'edit']) ||
            'views/modals/edit';

        Espo.Ui.notifyWait();

        const view = await this.createView('quickEdit', viewName, {scope, id});

        this.listenToOnce(view, 'after:save', () => this.calendar.refetchEvents());

        await view.render();

        Espo.Ui.notify(false);
    }

    /**
     * Delay left to the core to persist the change before refetching events.
     *
     * @type {number}
     */
    refetchDelay = 100;

    /**
     * Handles an `eventChange` from FullCalendar.
     * Only entities in `allDayScopeList` (e.g. Task) can switch between
     * grid and "all-day" display, so a refetch is needed only for them.
     *
     * @private
     * @param {{event: Object}} info
     * @returns {void}
     */
    handleEventChange(info) {
        // Only entities in allDayScopeList (Task) can change display.
        if (!this.allDayScopeList.includes(info.event.extendedProps.scope)) {
            return;
        }

        clearTimeout(this.refetchTimeout);

        this.refetchTimeout = setTimeout(() => {
            if (this.isRemoved() || !this.calendar) {
                return;
            }

            this.calendar.refetchEvents();
        }, this.refetchDelay);
    }

    /**
     * Initializes the date picker bound to the `.date-picker-btn` button.
     *
     * @private
     * @returns {void}
     */
    initDatePicker() {
        const $btn = this.$el.find('.date-picker-btn');

        if (!$btn.length) {
            console.warn('[ext-calendar] .date-picker-btn introuvable');
            return;
        }

        const $input = this.$datePickerInput = $('<input type="text">')
            .attr('tabindex', '-1')
            .css({
                position: 'absolute',
                opacity: 0,
                width: 0,
                height: 0,
                border: 0,
                padding: 0,
                pointerEvents: 'none',
            });

        $btn.after($input);

        this.datepicker = new Datepicker($input.get(0), {
            format: this.getDateTime().getDateFormat(),
            weekStart: this.getDateTime().weekStart,
            date: this.date,
            keyboardNavigation: false,
            hasDay: (dateString) => {
                if (this.prefs.showWeekends) {
                    return true;
                }

                const day = moment(
                    dateString,
                    this.getDateTime().getDateFormat()
                ).day();

                return day !== 0 && day !== 6;
            },
            onChange: () => this.handleDatePickerChange($input),
        });

        $btn.on('click', e => {
            e.preventDefault();
            e.stopPropagation();

            $input.trigger('click');
        });
    }

    /**
     * Handles date selection in the date picker input.
     * Navigates the calendar to the selected date and syncs the title.
     *
     * @param {JQuery} $input - The date picker input.
     * @returns {void}
     */
    handleDatePickerChange($input) {
        if (this.updatingPicker || !this.calendar) {
            return;
        }

        const value = $input.val();

        if (!value) {
            return;
        }

        const date = moment(value, this.getDateTime().getDateFormat());

        if (!date.isValid()) {
            return;
        }

        this.calendar.gotoDate(date.format('YYYY-MM-DD'));
        this.updateDate();
    }

    /**
     * Updates the calendar title (via the parent), appends the ISO week number
     * for week views, and syncs the date picker value.
     *
     * @returns {void}
     */
    updateDate() {
        super.updateDate();
        this.appendWeekNumber();

        if (!this.$datePickerInput || !this.calendar) {
            return;
        }

        const value = moment(this.calendar.getDate()).format(this.getDateTime().getDateFormat());

        this.updatingPicker = true;

        try {
            this.$datePickerInput.datepicker('setDate', value).datepicker('hide').blur();
        } finally {
            this.updatingPicker = false;
        }
    }

    /**
     * Appends the ISO week number below the date title when the calendar
     * is in week view.
     *
     * @private
     * @returns {void}
     */
    appendWeekNumber() {
        if (!this.calendar) {
            return;
        }

        const view = this.calendar.view;

        if (view.type !== 'timeGridWeek') {
            return;
        }

        const week = moment(view.currentStart).add(3, 'days').isoWeek();
        const label = this.translate('Week', 'labels', 'Calendar') + ' ' + week;

        const $title = this.$el.find('.date-title h4 span');

        $title
            .append($('<br>'))
            .append($('<small>').addClass('text-muted').text(label));
    }

    /**
     * Returns the list of currently displayed events, normalized to a
     * plain-object shape used by the PDF printer.
     *
     * @returns {Array<Object>}
     */
    getCalendarEvents() {
        if (!this.calendar) {
            console.warn('Calendar not initialized');
            return [];
        }

        return this.calendar.getEvents().map(event => {
            const props = event.extendedProps || {};

            return {
                id: props.recordId || event.id,
                recordId: props.recordId || null,
                scope: props.scope || null,

                title: event.title || '',

                // EspoCRM dates: keep the original values.
                start: props.dateStart || null,
                end: props.dateEnd || null,

                startDate: props.dateStartDate || null,
                endDate: props.dateEndDate || null,

                status: props.status || null,
                color: props.originalColor || event.backgroundColor || null,

                allDay: props.allDayCopy ?? event.allDay,
                duration: props.duration || null,
            };
        }).filter(event => event.start && event.end);
    }

    /**
     * An entity from `allDayScopeList` (e.g. Task) is displayed in the time grid
     * if it has start/end times and both fall on the same day.
     * Otherwise: standard EspoCRM behavior ("all-day" row).
     *
     * @param {Object} event
     * @param {boolean} [notInitial]
     * @returns {*}
     */
    handleAllDay(event, notInitial) {
        if (!this.isSameDayTimedEvent(event)) {
            return super.handleAllDay(event, notInitial);
        }

        // Temporarily remove the scope from the "all-day" list so the core
        // applies its normal logic (timed event).
        const list = this.allDayScopeList;

        this.allDayScopeList = list.filter(scope => scope !== event.scope);

        try {
            return super.handleAllDay(event, notInitial);
        } finally {
            this.allDayScopeList = list;
        }
    }

    /**
     * Whether the event is a same-day, timed event belonging to a scope
     * of `allDayScopeList` (so it should be placed in the time grid).
     *
     * @private
     * @param {Object} event
     * @returns {boolean}
     */
    isSameDayTimedEvent(event) {
        if (!this.allDayScopeList.includes(event.scope)) {
            return false;
        }

        // Date-only fields: cannot be placed in the time grid.
        if (!event.dateStart || !event.dateEnd || event.dateStartDate || event.dateEndDate) {
            return false;
        }

        const dateTime = this.getDateTime();

        return dateTime.toMoment(event.dateStart).isSame(dateTime.toMoment(event.dateEnd), 'day');
    }

    /**
     * Returns the "completed" / "canceled" status lists for every
     * displayed entity, read from EspoCRM metadata.
     *
     * @returns {Object<string, {completed: string[], canceled: string[]}>}
     */
    getStatusLists() {
        const lists = {};

        this.enabledScopeList.forEach(scope => {
            lists[scope] = {
                completed: this.getMetadata().get(['scopes', scope, 'completedStatusList']) || [],
                canceled: this.getMetadata().get(['scopes', scope, 'canceledStatusList']) || [],
            };
        });

        return lists;
    }

    /**
     * Computes the date bounds of the given FullCalendar view.
     *
     * @private
     * @param {Object} view - FullCalendar view object.
     * @returns {{
     *     startDate: Date,
     *     endDate: Date,
     *     fromUtcStr: string,
     *     toUtcStr: string,
     *     displayDate: moment.Moment,
     *     label: string,
     * }}
     */
    getPeriodBounds(view) {
        const {start, end, label} = this._getPeriodBounds(moment(view.activeStart));
        const format = this.getDateTime().internalDateTimeFormat;

        console.log(view);

        return {
            startDate: start.toDate(),
            endDate: end.toDate(),
            fromUtcStr: start.clone().utc().format(format),
            toUtcStr: end.clone().utc().format(format),
            displayDate: start,
            label,
        };
    }

    /**
     * Fetches the calendar events for the given period from the backend,
     * then converts them to FullCalendar-compatible events.
     *
     * @param {Object} period - Result of `getPeriodBounds`.
     * @returns {Promise<Array<Object>>}
     */
    async fetchCalendarEvents(period) {
        const url = this._buildEventsUrl(period);
        Espo.Ui.notifyWait();

        try {
            const data = await Espo.Ajax.getRequest(url);
            return this.convertToFcEvents(data);
        } finally {
            Espo.Ui.notify(false);
        }
    }

    /**
     * Builds the backend URL used to fetch calendar events for the given period.
     *
     * @private
     * @param {Object} period
     * @returns {string}
     */
    _buildEventsUrl(period) {
        let url = `Activities?from=${period.fromUtcStr}&to=${period.toUtcStr}`;

        if (this.getUser().id) {
            url += '&userId=' + this.getUser().id;
        }

        url += '&scopeList=' + encodeURIComponent(this.enabledScopeList.join(','));
        url += '&agenda=true';

        return url;
    }

    /**
     * Computes the calendar period bounds for the given view
     * (week, month or day, depending on the current mode).
     *
     * @private
     * @param {moment.Moment} reference
     * @returns {{start: moment.Moment, end: moment.Moment, label: string}}
     */
    _getPeriodBounds(reference) {
        switch (this.mode) {
            case 'agendaWeek':
                return {
                    start: reference.clone().isoWeekday(1).startOf('day'),
                    end: reference.clone().isoWeekday(this.prefs.showWeekends ? 7 : 5).endOf('day'),
                    label: this.prefs.showWeekends ? 'Week' : 'Weekdays'
                };

            case 'month':
                return {
                    start: reference.clone().startOf('month'),
                    end: reference.clone().endOf('month'),
                    label: 'Month'
                };

            default: // agendaDay
                return {
                    start: reference.clone().startOf('day'),
                    end: reference.clone().endOf('day'),
                    label: 'Day'
                };
        }
    }

    /**
     * Returns the PDF title matching the given FullCalendar view type.
     *
     * @private
     * @param {string} viewType
     * @returns {string}
     */
    getPrintTitle(viewType) {
        const map = {
            dayGridMonth: 'Calendar — Month',
            dayGridWeek: 'Calendar - Week',
            timeGridWeek: 'Calendar — Week',
            timeGridDay: 'Calendar — Day',
            listWeek: 'Calendar — List (Week)',
            listMonth: 'Calendar — List (Month)',
        };

        return map[viewType] || 'Calendar';
    }

    /**
     * Prints the currently visible calendar range to a PDF file.
     * Month view is not supported yet.
     *
     * @returns {Promise<void>}
     */
    async actionPrint() {
        if (!this.calendar) {
            return;
        }

        const view = this.calendar.view;
        const viewType = view.type;

        if (viewType === 'dayGridMonth' || viewType === 'dayGridWeek') {
            Espo.Ui.notify(this.translate('noPrintable', 'messages', 'Preferences'));
            return;
        }

        const period = this.getPeriodBounds(view);

        const rawEvents = await this.fetchCalendarEvents(period);

        const data = CalendarNormalizer.normalize(
            rawEvents,
            {
                start: period.startDate,
                end: period.endDate,
                label: period.label,
                viewType,
            },
            { timeZone: this.getDateTime().getTimeZone() }
        );

        await PdfPrinter.print({
            title: this.getPrintTitle(viewType),
            period: data.period,
            items: data.items,
            slotMinTime: this.prefs.getSlotMinTime(),
            slotMaxTime: this.prefs.getSlotMaxTime(),
            pageFormat: this.prefs.getPageFormat('calendar'),
            margin: this.prefs.getMargin('calendar'),
            dateFormat: this.getDateTime().getDateFormat(),
            timeFormat: this.getDateTime().getTimeFormat(),
            filename: `calendar-${viewType}.pdf`,
        });
    }
}