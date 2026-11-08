/************************************************************************
 * This file is part of EspoCRM.
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

/** @module ext-calendar:views/calendar/timeline */

import TimelineView from 'crm:views/calendar/timeline';
import Datepicker from 'ui/datepicker';
import CalendarPreferences from 'ext-calendar:helpers/calendar-preferences';
import CalendarNormalizer from 'ext-calendar:helpers/calendar-normalizer';
import PdfTimelinePrinter from 'ext-calendar:helpers/pdf-timeline-printer';

/**
 * Timeline calendar view.
 *
 * Extends the CRM timeline view with day navigation, slot preferences,
 * a date picker and PDF printing support.
 */
export default class extends TimelineView {

    /**
     * @type {string}
     */
    template = 'ext-calendar:calendar/timeline';

    /**
     * User calendar preferences.
     *
     * @type {CalendarPreferences}
     */
    prefs;

    /**
     * Debounce timeout used while the user scrolls with the wheel.
     *
     * @private
     * @type {number|null}
     */
    wheelTimeout = null;

    /**
     * Whether the date picker is currently being updated programmatically.
     * Used to avoid feedback loops between the picker and the timeline.
     *
     * @private
     * @type {boolean}
     */
    updatingPicker = false;

    /**
     * Timeline instance the date picker was bound to.
     * Prevents binding the picker multiple times to the same timeline.
     *
     * @private
     * @type {Object|null}
     */
    pickerTimeline = null;

    /**
     * Timeline instance the slot preferences were applied to.
     * Prevents re-applying slot preferences multiple times per timeline.
     *
     * @private
     * @type {Object|null}
     */
    slotsAppliedTo = null;

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
            'click button[data-action="prev"]': () => this.actionPrevious(),
            'click button[data-action="next"]': () => this.actionNext(),
            'click button[data-action="print"]': () => this.actionPrint(),
        };
    }

    /**
     * Called after the view is rendered.
     * Waits for the timeline to be available, then initializes the date picker
     * and applies the slot preferences.
     *
     * @returns {void}
     */
    afterRender() {
        super.afterRender();

        this.pickerTimeline = null;

        this.waitForTimeline(() => {
            this.applySlotPreferences();
            this.initDatePicker();
        });
    }

    /**
     * Waits asynchronously until `this.timeline` is available and its DOM
     * element is rendered (the timeline may be created after the events are loaded).
     * Polls every 100ms, gives up after 50 attempts (~5 seconds).
     *
     * @param {function(): void} callback - Called once the timeline is ready.
     * @returns {void}
     */
    waitForTimeline(callback) {
        let attempts = 0;

        const timer = setInterval(() => {
            attempts++;

            if (this.timeline && this.$el.find('.timeline').length) {
                clearInterval(timer);
                callback();

                return;
            }

            if (attempts > 50) {
                clearInterval(timer);
            }
        }, 100);

        this.once('remove', () => clearInterval(timer));
    }

    /**
     * Displays the day of `date`, from `hourFrom` to `hourTo`.
     *
     * @param {moment.Moment} date
     * @returns {void}
     */
    setTimelineWindow(date) {
        const day = date.clone().startOf('day');

        this.timeline.setWindow(
            day.clone().add(this.prefs.slotFrom, 'hours').toDate(),
            day.clone().add(this.prefs.slotTo, 'hours').toDate(),
        );
    }

    /**
     * Applies the slot range from preferences once per timeline instance,
     * keeping the currently displayed day.
     *
     * @private
     * @returns {void}
     */
    applySlotPreferences() {
        if (!this.timeline || this.slotsAppliedTo === this.timeline) {
            return;
        }

        this.slotsAppliedTo = this.timeline;

        const range = this.timeline.getWindow();
        const center = (range.start.getTime() + range.end.getTime()) / 2;
        const day = moment.tz(center, this.getDateTime().getTimeZone());

        this.setTimelineWindow(this.skipHiddenDays(day, 1));
    }

    /**
     * Handles the "previous" button click: navigates one day backward.
     *
     * @returns {void}
     */
    actionPrevious() {
        this.navigateDay(-1);
    }

    /**
     * Handles the "next" button click: navigates one day forward.
     *
     * @returns {void}
     */
    actionNext() {
        this.navigateDay(1);
    }

    /**
     * Navigates by the given number of days relative to the current window.
     *
     * @param {number} direction - `-1` for previous, `1` for next.
     * @returns {void}
     */
    navigateDay(direction) {
        if (!this.timeline) {
            return;
        }

        const timeZone = this.getDateTime().getTimeZone();

        let target = moment
            .tz(this.timeline.getWindow().start, timeZone)
            .add(direction, 'day');

        target = this.skipHiddenDays(target, direction);

        this.setTimelineWindow(target);
    }

    /**
     * Skips hidden days (weekends) from the given date, moving in the given direction,
     * unless weekends are configured to be shown.
     *
     * @param {moment.Moment} date
     * @param {number} direction - `-1` to move backward, `1` to move forward.
     * @returns {moment.Moment}
     */
    skipHiddenDays(date, direction) {
        if (this.prefs.showWeekends) {
            return date;
        }

        const result = date.clone();

        while (result.isoWeekday() > 5) {
            result.add(direction, 'day');
        }

        return result;
    }

    /**
     * Handles date selection in the date picker input.
     * Updates the timeline window to the selected date.
     *
     * @param {JQuery} $input - The date picker input.
     * @returns {void}
     */
    handleDatePickerChange($input) {
        // Change triggered by the timeline itself: do not bounce back.
        if (this.updatingPicker || !this.timeline) {
            return;
        }

        const value = $input.val();

        if (!value) {
            return;
        }

        const date = moment.tz(
            value,
            this.getDateTime().getDateFormat(),
            this.getDateTime().getTimeZone(),
        );

        if (!date.isValid()) {
            return;
        }

        this.setTimelineWindow(this.skipHiddenDays(date, 1));
    }

    /**
     * Handles a `rangechanged` event from the timeline.
     * Debounces the update when the change comes from the mouse wheel,
     * then updates the date picker to reflect the visible range.
     *
     * @param {{start: Date, end: Date, event?: Event}} e
     * @param {JQuery} $input - The date picker input.
     * @returns {void}
     */
    handleRangeChanged(e, $input) {
        const update = () => this.updateDatePicker(e, $input);

        // Mouse wheel fires many events: wait for scrolling to end.
        if (e.event instanceof WheelEvent) {
            clearTimeout(this.wheelTimeout);
            this.wheelTimeout = setTimeout(update, 1000);

            return;
        }

        update();
    }

    /**
     * Initializes the date picker bound to the date picker button.
     * Only runs once per timeline instance.
     *
     * @private
     * @returns {void}
     */
    initDatePicker() {
        const $btn = this.$el.find('.date-picker-btn');

        // Bind only once per timeline instance.
        if (!$btn.length || !this.timeline || this.pickerTimeline === this.timeline) {
            return;
        }

        this.pickerTimeline = this.timeline;

        const $input = $('<input type="text">')
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

        this.timeline.on('rangechanged', e => this.handleRangeChanged(e, $input));
    }

    /**
     * Updates the date picker value to the middle of the given range
     * and hides it.
     *
     * @param {{start: Date, end: Date}} e
     * @param {JQuery} $input - The date picker input.
     * @returns {void}
     */
    updateDatePicker(e, $input) {
        const center = (e.start.getTime() + e.end.getTime()) / 2;

        const value = moment
            .tz(center, this.getDateTime().getTimeZone())
            .format(this.getDateTime().getDateFormat());

        this.updatingPicker = true;

        try {
            $input.datepicker('setDate', value).datepicker('hide').blur();
        } finally {
            this.updatingPicker = false;
        }
    }

    /**
     * Prints the currently visible timeline window to a PDF file
     * using the configured page format and margins.
     *
     * @returns {Promise<void>}
     */
    async actionPrint() {
        if (!this.timeline) {
            return;
        }

        const dateTime = this.getDateTime();
        const range = this.timeline.getWindow();

        const items = this.timeline.itemsData ? this.timeline.itemsData.get() : [];
        const groups = this.timeline.groupsData ? this.timeline.groupsData.get() : [];

        const data = CalendarNormalizer.normalizeTimeline(
            items,
            groups,
            {
                start: range.start,
                end: range.end,
                label: 'Day',
                viewType: 'timeline',
            },
            {
                timeZone: dateTime.getTimeZone(),
                toMoment: value => dateTime.toMoment(value),
            }
        );

        await PdfTimelinePrinter.print({
            title: 'Calendar — Timeline',
            period: data.period,
            groups: data.groups,
            items: data.items,
            slotMinTime: this.prefs.getSlotMinTime(),
            slotMaxTime: this.prefs.getSlotMaxTime(),
            pageFormat: this.prefs.getPageFormat('timeline'),
            margin: this.prefs.getMargin('timeline'),
            dateFormat: dateTime.getDateFormat(),
            timeFormat: dateTime.getTimeFormat(),
            filename: 'calendar-timeline.pdf',
        });
    }
}
