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
import PdfPrinter from 'ext-calendar:helpers/pdf-printer';

export default class extends TimelineView {

    template = 'ext-calendar:calendar/timeline';

     /** @type {CalendarPreferences} */
    prefs;
    /** @private */
    wheelTimeout = null;
    /** @private */
    updatingPicker = false;
    /**
     * Instance de timeline sur laquelle le sélecteur de date est branché.
     * @private
     */
    pickerTimeline = null;

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

    afterRender() {
        super.afterRender();

        this.pickerTimeline = null;

        this.waitForTimeline(() => this.initDatePicker());

    }

        /**
     * this.timeline async (after events).
     *
     * @param {function(): void} callback
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
                console.error('[ext-calendar] timeline not ready');
            }
        }, 100);

        this.once('remove', () => clearInterval(timer));
    }

    actionPrevious() {
        this.navigateDay(-1);
    }

    actionNext() {
        this.navigateDay(1);
    }

    /**
     * @param {number} direction -1 ou 1
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
     * @param {moment.Moment} date
     * @param {number} direction
     * @return {moment.Moment}
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
     * Affiche la journée de `date`, de hourFrom à hourTo.
     *
     * @param {moment.Moment} date
     */
    setTimelineWindow(date) {
        const day = date.clone().startOf('day');

        this.timeline.setWindow(
            day.clone().add(this.prefs.slotFrom, 'hours').toDate(),
            day.clone().add(this.prefs.slotTo, 'hours').toDate(),
        );
    }

    /** @private */
    initDatePicker() {
        const $btn = this.$el.find('.date-picker-btn');

        // Un seul branchement par instance de timeline.
        if (!$btn.length || !this.timeline || this.pickerTimeline === this.timeline) {
            return;
        }

        this.extPickerTimeline = this.timeline;

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
     * @param {JQuery} $input
     */
    handleDatePickerChange($input) {
        // Changement provoqué par la timeline elle-même : on ne repart pas dans l'autre sens.
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
     * @param {{start: Date, end: Date, event?: Event}} e
     * @param {JQuery} $input
     */
    handleRangeChanged(e, $input) {
        const update = () => this.updateDatePicker(e, $input);

        // La molette déclenche beaucoup d'événements : on attend la fin du défilement.
        if (e.event instanceof WheelEvent) {
            clearTimeout(this.wheelTimeout);
            this.wheelTimeout = setTimeout(update, 1000);

            return;
        }

        update();
    }

    /**
     * @param {{start: Date, end: Date}} e
     * @param {JQuery} $input
     */
    updateDatePicker(e, $input) {
        const center = (e.start.getTime() + e.end.getTime()) / 2;

        const value = moment
            .tz(center, this.getDateTime().getTimeZone())
            .format(this.getDateTime().getDateFormat());

        this.extUpdatingPicker = true;

        try {
            $input.datepicker('setDate', value).datepicker('hide').blur();
        } finally {
            this.updatingPicker = false;
        }
    }

    async actionPrint() {
        if (!this.timeline) {
            return;
        }

        const events = this.timeline.getItems
            ? this.timeline.getItems().map(item => ({
                title: item.content,
                start: item.start,
                end: item.end,
                allDay: false,
            }))
            : [];

        await PdfPrinter.print({
            title: 'Calendar — Timeline',
            events,
            filename: 'calendar-timeline.pdf',
            dateFormat: this.getDateTime().getDateFormat(),
        });
    }
}