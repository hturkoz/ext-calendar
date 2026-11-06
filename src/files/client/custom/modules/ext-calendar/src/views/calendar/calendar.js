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

/** @module ext-calendar:views/calendar/calendar */

import CalendarView from 'crm:views/calendar/calendar';
import Datepicker from 'ui/datepicker';
import CalendarPreferences from 'ext-calendar:helpers/calendar-preferences';
import PdfPrinter from 'ext-calendar:helpers/pdf-printer';

export default class extends CalendarView {

    template = 'ext-calendar:calendar/calendar';

    /** @private */
    preferencesApplied = false;
    /** @private */
    updatingPicker = false;
    /** @private */
    preferences = null;

    setup() {
        super.setup();

        this.prefs = new CalendarPreferences(this.getPreferences());

        this.events = {
            ...this.events,
            'click button[data-action="print"]': () => this.actionPrint(),
        };
    }

    afterRender() {
        
        this.preferencesApplied = false;

        super.afterRender();

        this.initDatePicker();

    }

    /**
     * Appelée par le core juste après la création et le rendu du calendrier.
     */
    handleScrollToNow(...args) {
        this.applyPreferences();

        return super.handleScrollToNow(...args);
    }

    /** @private */
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
        
    }

       /** @private */
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
     * @param {JQuery} $input
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

    /** @private */
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

    /** PRINT **/
    async actionPrint() {
        if (!this.calendar) {
            return;
        }

        const viewType = this.calendar.view.type;

        const events = this.calendar.getEvents().map(e => ({
            title: e.title,
            start: e.start,
            end: e.end,
            allDay: e.allDay,
        }));

        const title = this.getPrintTitle(viewType);

        await PdfPrinter.print({
            title,
            events,
            filename: `calendar-${viewType}.pdf`,
            dateFormat: this.getDateTime().getDateFormat(),
        });
    }

    /** @private */
    getPrintTitle(viewType) {
        const map = {
            dayGridMonth: 'Calendar — Month',
            timeGridWeek: 'Calendar — Week',
            timeGridDay: 'Calendar — Day',
            listWeek: 'Calendar — List (Week)',
            listMonth: 'Calendar — List (Month)',
        };

        return map[viewType] || 'Calendar';
    }
}
