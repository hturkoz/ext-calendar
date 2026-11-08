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

/** @module ext-calendar:helpers/calendar-normalizer */

const DAY_FORMAT = 'YYYY-MM-DD';

/** CSS class set by EspoCRM on canceled events. */
const CANCELED_CLASS = 'event-canceled';

/** CSS class for non-working ranges in the timeline (items of type 'background'). */
const NON_WORKING_CLASS = 'non-working';

/** Color for non-working areas when the source does not provide one (same as the calendar). */
const NON_WORKING_COLOR = '#323a49b3';

/** Additional EspoCRM fields kept as-is (to be adapted). */
const EXTRA_FIELDS = [];

/**
 * Normalizes calendar and timeline data into a shared model
 * consumed by the PDF printers.
 */
export default class CalendarNormalizer {

    // ------------------------------------------------------------------
    // Calendar (FullCalendar)
    // ------------------------------------------------------------------

    /**
     * Normalizes FullCalendar events.
     *
     * @param {Object[]} rawEvents - Result of `convertToFcEvents()`.
     * @param {{start: Date|moment.Moment, end: Date|moment.Moment, label?: string, viewType?: string}} period
     * @param {{timeZone?: string}} [options]
     * @returns {{period: Object, groups: Object[], items: Object[]}}
     */
    static normalize(rawEvents, period, options = {}) {
        const timeZone = options.timeZone || null;
        const start = this.inZone(moment(period.start), timeZone);
        const end = this.inZone(moment(period.end), timeZone);

        const workingRaw = rawEvents.filter(e => e.groupId === 'nonWorking');
        const eventsRaw = rawEvents.filter(e => e.recordId && e.scope);

        const items = [
            ...this.buildCalendarNonWorking(workingRaw, start, end, timeZone),
            ...eventsRaw
                .map(e => this.buildCalendarEvent(e, timeZone))
                .sort((a, b) => a.start - b.start),
        ];

        return {period: this.createPeriod(start, end, period), groups: [], items};
    }

    /**
     * Converts a FullCalendar event into the shared event model.
     *
     * @param {Object} e - Raw FullCalendar event.
     * @param {string|null} timeZone
     * @returns {Object}
     */
    static buildCalendarEvent(e, timeZone) {
        return this.createEvent({
            id: e.id,
            recordId: e.recordId,
            scope: e.scope,
            title: e.title,
            status: e.status,
            canceled: this.hasClass(e.className, CANCELED_CLASS),
            allDay: e.allDay,
            start: this.inZone(moment(e.start), timeZone),
            end: this.inZone(moment(e.end), timeZone),
            color: e.color,
            originalColor: e.originalColor,
            group: null,
            extra: this.pickExtra(e),
        });
    }

    /**
     * In the calendar view, EspoCRM provides WORK ranges (groupId 'nonWorking',
     * displayed as 'inverse-background'): the shaded areas are their complement.
     *
     * @param {Object[]} workingRaw - Work ranges.
     * @param {moment.Moment} periodStart
     * @param {moment.Moment} periodEnd
     * @param {string|null} timeZone
     * @returns {Object[]}
     */
    static buildCalendarNonWorking(workingRaw, periodStart, periodEnd, timeZone) {
        // No working calendar → nothing is shaded (otherwise everything would be gray).
        if (!workingRaw.length) {
            return [];
        }

        const color = this.parseColor(workingRaw[0].color) || this.parseColor(NON_WORKING_COLOR);

        const ranges = workingRaw
            .map(e => ({
                start: this.inZone(moment(e.start), timeZone),
                end: this.inZone(moment(e.end), timeZone),
            }))
            .sort((a, b) => a.start - b.start);

        const result = [];

        for (const day = moment(periodStart).startOf('day'); day.isBefore(periodEnd); day.add(1, 'day')) {
            const dayStart = day.clone();
            const dayEnd = day.clone().add(1, 'day');
            let cursor = dayStart.clone();

            for (const range of ranges) {
                if (range.end.isSameOrBefore(dayStart) || range.start.isSameOrAfter(dayEnd)) {
                    continue;
                }

                const from = moment.max(range.start, dayStart);
                const to = moment.min(range.end, dayEnd);

                if (from.isAfter(cursor)) {
                    result.push(this.createNonWorking(dayStart, cursor, from, color, null));
                }

                if (to.isAfter(cursor)) {
                    cursor = to;
                }
            }

            if (cursor.isBefore(dayEnd)) {
                result.push(this.createNonWorking(dayStart, cursor, dayEnd, color, null));
            }
        }

        return result;
    }

    // ------------------------------------------------------------------
    // Timeline (vis-timeline)
    // ------------------------------------------------------------------

    /**
     * Normalizes vis-timeline items and groups.
     *
     * @param {Object[]} visItems - `timeline.itemsData.get()`.
     * @param {Object[]} visGroups - `timeline.groupsData.get()`.
     * @param {{start: Date|moment.Moment, end: Date|moment.Moment, label?: string, viewType?: string}} period
     * @param {{
     *     timeZone?: string,
     *     toMoment?: function(string): moment.Moment,
     * }} [options]
     *   `toMoment`: converts internal UTC dates (`'YYYY-MM-DD HH:mm:ss'`),
     *   typically `value => this.getDateTime().toMoment(value)`.
     * @returns {{period: Object, groups: {id: string, label: string}[], items: Object[]}}
     */
    static normalizeTimeline(visItems, visGroups, period, options = {}) {
        const timeZone = options.timeZone || null;
        const toMoment = options.toMoment || (value => moment.utc(value, 'YYYY-MM-DD HH:mm:ss'));

        const start = this.inZone(moment(period.start), timeZone);
        const end = this.inZone(moment(period.end), timeZone);

        const groups = [...visGroups]
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map(group => ({id: group.id, label: this.htmlToText(group.content)}));

        const nonWorking = [];
        const events = [];

        visItems.forEach(item => {
            if (item.type === 'background') {
                if (this.hasClass(item.className, NON_WORKING_CLASS)) {
                    nonWorking.push(...this.buildTimelineNonWorking(item, start, end, toMoment, timeZone));
                }

                return;
            }

            const event = this.buildTimelineEvent(item, toMoment, timeZone);

            if (event) {
                events.push(event);
            }
        });

        events.sort((a, b) => a.start - b.start);

        return {
            period: this.createPeriod(start, end, period),
            groups,
            items: [...nonWorking, ...events],
        };
    }

    /**
     * A non-working range can span multiple days (night, weekend):
     * it is split by day, like in the calendar view.
     *
     * @param {Object} item - vis-timeline item.
     * @param {moment.Moment} periodStart
     * @param {moment.Moment} periodEnd
     * @param {function(string): moment.Moment} toMoment
     * @param {string|null} timeZone
     * @returns {Object[]}
     */
    static buildTimelineNonWorking(item, periodStart, periodEnd, toMoment, timeZone) {
        const from = this.itemTime(item, 'start', toMoment, timeZone);
        const to = this.itemTime(item, 'end', toMoment, timeZone);

        if (!from || !to) {
            return [];
        }

        const color = this.parseColor(item.color) ||
            this.parseColor(this.colorFromStyle(item.style)) ||
            this.parseColor(NON_WORKING_COLOR);

        return this.splitByDay(from, to, periodStart, periodEnd)
            .map(part => this.createNonWorking(part.day, part.start, part.end, color, item.group));
    }

    /**
     * Converts a vis-timeline item into the shared event model.
     * Returns `null` for background or non-record items.
     *
     * @param {Object} item
     * @param {function(string): moment.Moment} toMoment
     * @param {string|null} timeZone
     * @returns {Object|null}
     */
    static buildTimelineEvent(item, toMoment, timeZone) {
        const recordId = item['record-id'] ?? item.recordId ?? null;
        const scope = item['scope-name'] ?? item.scope ?? null;

        // Same as the calendar view: only actual records are events.
        if (!recordId || !scope) {
            return null;
        }

        const start = this.itemTime(item, 'start', toMoment, timeZone);

        if (!start) {
            return null;
        }

        let end = this.itemTime(item, 'end', toMoment, timeZone);

        // 'box' item (no end): minimum duration of 30 minutes, like in the calendar view.
        if (!end || !end.isAfter(start)) {
            end = start.clone().add(30, 'minutes');
        }

        return this.createEvent({
            id: item.id ?? `${scope}-${recordId}`,
            recordId,
            scope,
            title: this.htmlToText(item.content),
            status: item.status,
            canceled: this.hasClass(item.className, CANCELED_CLASS),
            allDay: false,
            start,
            end,
            color: item.color || this.colorFromStyle(item.style),
            originalColor: item.originalColor,
            group: item.group,
            extra: this.pickExtra(item),
        });
    }

    // ------------------------------------------------------------------
    // Shared builders (the shared model)
    // ------------------------------------------------------------------

    /**
     * Builds the period object used by the PDF printers.
     *
     * @param {moment.Moment} start
     * @param {moment.Moment} end
     * @param {{label?: string, viewType?: string}} period
     * @returns {{start: moment.Moment, end: moment.Moment, label: string|undefined, viewType: string|undefined}}
     */
    static createPeriod(start, end, period) {
        return {start, end, label: period.label, viewType: period.viewType};
    }

    /**
     * Builds a normalized event.
     *
     * @param {Object} fields
     * @returns {Object}
     */
    static createEvent(fields) {
        return {
            kind: 'event',
            id: fields.id,
            recordId: fields.recordId,
            scope: fields.scope,
            title: fields.title || '',
            status: fields.status || null,
            state: fields.canceled ? 'canceled' : 'active',
            allDay: !!fields.allDay,
            start: fields.start,
            end: fields.end,
            color: this.parseColor(fields.color),
            originalColor: fields.originalColor || null,
            group: fields.group || null,
            extra: fields.extra || {},
        };
    }

    /**
     * Builds a normalized non-working range.
     *
     * @param {moment.Moment} day - The day this range belongs to.
     * @param {moment.Moment} start
     * @param {moment.Moment} end
     * @param {{hex: string, rgb: {r: number, g: number, b: number}, opacity: number}|null} color
     * @param {string|null} group
     * @returns {Object}
     */
    static createNonWorking(day, start, end, color, group) {
        return {
            kind: 'nonWorking',
            day: day.format(DAY_FORMAT),
            start: start.clone(),
            end: end.clone(),
            color,
            group: group || null,
        };
    }

    // ------------------------------------------------------------------
    // Utilities
    // ------------------------------------------------------------------

    /**
     * Splits `[start, end[` at midnight boundaries, within the given period.
     *
     * @param {moment.Moment} start
     * @param {moment.Moment} end
     * @param {moment.Moment} periodStart
     * @param {moment.Moment} periodEnd
     * @returns {{day: moment.Moment, start: moment.Moment, end: moment.Moment}[]}
     */
    static splitByDay(start, end, periodStart, periodEnd) {
        const parts = [];

        for (const day = moment(periodStart).startOf('day'); day.isBefore(periodEnd); day.add(1, 'day')) {
            const dayStart = day.clone();
            const dayEnd = day.clone().add(1, 'day');
            const from = moment.max(start, dayStart);
            const to = moment.min(end, dayEnd);

            if (to.isAfter(from)) {
                parts.push({day: dayStart, start: from, end: to});
            }
        }

        return parts;
    }

    /**
     * Returns the date of a vis-timeline item for the given field.
     * A `Date` or `moment` is unambiguous; a string is read from
     * `date-start` / `date-end` (EspoCRM internal UTC).
     *
     * @param {Object} item
     * @param {'start'|'end'} which
     * @param {function(string): moment.Moment} toMoment
     * @param {string|null} timeZone
     * @returns {moment.Moment|null}
     */
    static itemTime(item, which, toMoment, timeZone) {
        const value = item[which];
        let result = null;

        if (value instanceof Date || moment.isMoment(value)) {
            result = moment(value);
        } else if (item['date-' + which]) {
            result = toMoment(item['date-' + which]);
        } else if (value) {
            result = moment(value);
        }

        return result ? this.inZone(result, timeZone) : null;
    }

    /**
     * Converts a moment to the given timezone (no-op if `timeZone` is falsy).
     *
     * @param {moment.Moment} m
     * @param {string|null} timeZone
     * @returns {moment.Moment}
     */
    static inZone(m, timeZone) {
        return timeZone ? m.tz(timeZone) : m;
    }

    /**
     * Extracts the additional fields listed in `EXTRA_FIELDS` from the given source.
     *
     * @param {Object} source
     * @returns {Object}
     */
    static pickExtra(source) {
        const extra = {};

        EXTRA_FIELDS.forEach(field => {
            if (source[field] !== undefined) {
                extra[field] = source[field];
            }
        });

        return extra;
    }

    /**
     * Whether the given CSS class name is present.
     * `className` can be either a string or an array.
     *
     * @param {string|string[]|null|undefined} className
     * @param {string} name
     * @returns {boolean}
     */
    static hasClass(className, name) {
        return [].concat(className || []).join(' ').split(/\s+/).includes(name);
    }

    /**
     * Returns the plain text of an HTML fragment.
     * Uses `DOMParser`: does not execute scripts nor load images.
     *
     * @param {string|null|undefined} html
     * @returns {string}
     */
    static htmlToText(html) {
        if (!html) {
            return '';
        }

        const text = new DOMParser().parseFromString(String(html), 'text/html').body.textContent;

        return (text || '').replace(/\s+/g, ' ').trim();
    }

    /**
     * Extracts a hex color from a `style` attribute
     * (`background-color`, falling back to `border-color`).
     *
     * @param {string|null|undefined} style
     * @returns {string|null}
     */
    static colorFromStyle(style) {
        if (!style) {
            return null;
        }

        const match = /background-color\s*:\s*(#[0-9a-fA-F]{3,8})/.exec(style) ||
            /border-color\s*:\s*(#[0-9a-fA-F]{3,8})/.exec(style);

        return match ? match[1] : null;
    }

    /**
     * Parses a hex color: `'#RGB'`, `'#RRGGBB'` or `'#RRGGBBAA'`
     * into `{hex, rgb: {r, g, b} (0-1), opacity (0-1)}`.
     *
     * @param {string|null|undefined} value
     * @returns {{hex: string, rgb: {r: number, g: number, b: number}, opacity: number}|null}
     */
    static parseColor(value) {
        if (!value || typeof value !== 'string' || value[0] !== '#') {
            return null;
        }

        let h = value.slice(1);

        if (h.length === 3 || h.length === 4) {
            h = h.split('').map(c => c + c).join('');
        }

        if (h.length !== 6 && h.length !== 8) {
            return null;
        }

        return {
            hex: '#' + h.slice(0, 6),
            rgb: {
                r: parseInt(h.slice(0, 2), 16) / 255,
                g: parseInt(h.slice(2, 4), 16) / 255,
                b: parseInt(h.slice(4, 6), 16) / 255,
            },
            opacity: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
        };
    }
}
