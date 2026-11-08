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

/** @module ext-calendar:helpers/calendar-preferences */

/**
 * Reads the calendar preferences of the user.
 * Returns `null` for any undefined or invalid value,
 * so that the default core behavior is preserved.
 */

import { PAGE_FORMAT, DEFAULT_PAGE_FORMAT } from 'ext-calendar:helpers/calendar-constants';

/**
 * User calendar preferences (weekends, slot range, PDF page format/margin).
 */
export default class CalendarPreferences {

    /**
     * Raw page-format preference keys per view type.
     *
     * @type {{calendar: string|null, timeline: string|null}}
     */
    #pageFormatKeys;

    /**
     * Raw layout preference keys per view type.
     *
     * @type {{calendar: string|null, timeline: string|null}}
     */
    #layouts;

    /**
     * Parsed margin (in points) per view type.
     *
     * @type {{calendar: number|null, timeline: number|null}}
     */
    #margins;

    /**
     * @param {import('models/preferences').default} preferences
     */
    constructor(preferences) {

        const from = this.#toHour(preferences.get('slotFrom'));
        const to = this.#toHour(preferences.get('slotTo'));

        /**
         * Whether weekends are shown.
         *
         * @type {boolean}
         */
        this.showWeekends = preferences.get('showWeekends') !== false;

        const rangeIsValid = from !== null && to !== null && from < to;

        /**
         * Slot start hour, or `null` if undefined/invalid.
         *
         * @type {number|null}
         */
        this.slotFrom = rangeIsValid ? from : null;

        /**
         * Slot end hour, or `null` if undefined/invalid.
         *
         * @type {number|null}
         */
        this.slotTo = rangeIsValid ? to : null;

        this.#pageFormatKeys = {
            calendar: preferences.get('calendarPageFormat') || null,
            timeline: preferences.get('timelinePageFormat') || null,
        };

        this.#layouts = {
            calendar: preferences.get('calendarLayout') || null,
            timeline: preferences.get('timelineLayout') || null,
        };

        this.#margins = {
            calendar: this.#toMargin(preferences.get('calendarMargin')),
            timeline: this.#toMargin(preferences.get('timelineMargin')),
        };
    }

    /**
     * Returns the slot start time as a duration string, e.g. `"08:00:00"`,
     * or `null` if no valid slot range is configured.
     *
     * @returns {string|null}
     */
    getSlotMinTime() {
        return this.slotFrom === null ? null : this.#format(this.slotFrom);
    }

    /**
     * Returns the slot end time as a duration string, e.g. `"24:00:00"`,
     * or `null` if no valid slot range is configured.
     *
     * @returns {string|null}
     */
    getSlotMaxTime() {
        return this.slotTo === null ? null : this.#format(this.slotTo);
    }

    /**
     * Returns the PDF page size in points for the given view type.
     *
     * @param {'calendar'|'timeline'} type
     * @returns {number[]} `[width, height]`, e.g. `[842, 595]`.
     */
    getPageFormat(type) {
        const format = this.#pageFormatKeys[type];
        const layout = this.#layouts[type];

        if (format && layout) {
            const key = `${format}_${layout}`;

            if (PAGE_FORMAT[key]) {
                return PAGE_FORMAT[key];
            }
        }

        return DEFAULT_PAGE_FORMAT;
    }

    /**
     * Returns the raw layout preference for the given view type
     * (e.g. `"portrait"`, `"landscape"`), or `null`.
     *
     * @param {'calendar'|'timeline'} type
     * @returns {string|null}
     */
    getLayout(type) {
        return this.#layouts[type];
    }

    /**
     * Returns the PDF page margin in points for the given view type,
     * or `null` if undefined/invalid (the printer will use its default).
     *
     * @param {'calendar'|'timeline'} type
     * @returns {number|null}
     */
    getMargin(type) {
        return this.#margins[type];
    }

    /**
     * Parses an hour value into an integer.
     *
     * @private
     * @param {string|number|null|undefined} value - e.g. `"08:00"`.
     * @returns {number|null} The parsed hour, or `null` if invalid.
     */
    #toHour(value) {
        const hour = parseInt(value ?? '');

        return isNaN(hour) ? null : hour;
    }

    /**
     * Formats an integer hour as a duration string.
     *
     * @private
     * @param {number} hour
     * @returns {string} e.g. `"08:00:00"`.
     */
    #format(hour) {
        return String(hour).padStart(2, '0') + ':00:00';
    }

    /**
     * Parses a margin value into a non-negative integer.
     *
     * @private
     * @param {string|number|null|undefined} value
     * @returns {number|null} The parsed margin, or `null` if invalid/negative.
     */
    #toMargin(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        const margin = parseInt(value);

        return isNaN(margin) || margin < 0 ? null : margin;
    }
}
