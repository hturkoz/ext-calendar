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

/** @module ext-calendar:helpers/pdf-calendar-printer */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Default page settings (A4 landscape).
 *
 * @type {{width: number, height: number, margin: number}}
 */
const DEFAULT_PAGE = { width: 842, height: 595, margin: 30 }; // A4 landscape

/** Width in points of the left time-axis column. */
const AXIS_WIDTH = 34;

/** Height in points of the day header row. */
const HEADER_HEIGHT = 20;

/** Height in points of a single "all-day" event row. */
const ALL_DAY_ROW_HEIGHT = 14;

/** Minimum height in points of a timed event box. */
const MIN_EVENT_HEIGHT = 10;

/** Day key format used to match non-working ranges to a specific day. */
const DAY_KEY = 'YYYY-MM-DD';

/**
 * Non-working areas are lightened on print
 * (0 = invisible, 1 = on-screen color).
 */
const NON_WORKING_OPACITY_SCALE = 0.4;

/**
 * Background lightening applied by event state
 * (0 = original color, 1 = white).
 *
 * @type {Object<string, number>}
 */
const STATE_LIGHTEN = { completed: 0.45, canceled: 0.45 };

/**
 * Fallback color used when an event has no color defined.
 *
 * @type {{hex: string, rgb: {r: number, g: number, b: number}, opacity: number}}
 */
const FALLBACK_COLOR = { hex: '#8a9bb8', rgb: { r: 0.54, g: 0.61, b: 0.72 }, opacity: 1 };

/**
 * Renders a calendar (day/week grid with timed and all-day events) to a PDF document.
 */
export default class PdfPrinter {

    /**
     * Builds and downloads the calendar PDF.
     *
     * @param {object} options
     * @param {string} options.title - Document title.
     * @param {{start: moment.Moment, end: moment.Moment, label: string, viewType: string}} options.period
     * @param {Array<object>} options.items - Result of `CalendarNormalizer.normalize().items`.
     * @param {string} options.dateFormat - User date format (EspoCRM preferences).
     * @param {string} options.timeFormat - User time format (EspoCRM preferences).
     * @param {string} [options.slotMinTime] - e.g. `"08:00:00"`.
     * @param {string} [options.slotMaxTime] - e.g. `"18:00:00"`.
     * @param {[number, number]|null} [options.pageFormat] - `[width, height]` in points, or `null` for A4 landscape.
     * @param {number|null} [options.margin] - Page margin in points, or `null` for the default.
     * @param {string} [options.filename] - Downloaded file name.
     * @returns {Promise<void>}
     * @throws {Error} If `dateFormat` or `timeFormat` is missing.
     */
    static async print(options) {
        const {
            title,
            period,
            items,
            slotMinTime,
            slotMaxTime,
            pageFormat,
            margin,
            dateFormat,
            timeFormat,
            filename = 'calendar.pdf',
        } = options;

        if (!dateFormat || !timeFormat) {
            throw new Error('PdfPrinter: dateFormat and timeFormat are required (user preferences).');
        }

        const PAGE = {
            width: Array.isArray(pageFormat) ? pageFormat[0] : DEFAULT_PAGE.width,
            height: Array.isArray(pageFormat) ? pageFormat[1] : DEFAULT_PAGE.height,
            margin: (typeof margin === 'number' && margin >= 0) ? margin : DEFAULT_PAGE.margin,
        };

        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([PAGE.width, PAGE.height]);
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        const days = PdfPrinter.getDays(period);
        const minMin = PdfPrinter.toMinutes(slotMinTime, 0);
        const maxMin = PdfPrinter.toMinutes(slotMaxTime, 24 * 60);
        const span = maxMin - minMin;

        const dayIndex = {};
        days.forEach((d, i) => dayIndex[d.format(DAY_KEY)] = i);

        // --- Title ---
        const titleY = PAGE.height - PAGE.margin - 14;

        page.drawText(PdfPrinter.safe(title), { x: PAGE.margin, y: titleY, size: 16, font: fontBold });
        page.drawText(
            `${period.start.format(dateFormat)} - ${period.end.format(dateFormat)}`,
            { x: PAGE.margin, y: titleY - 14, size: 9, font, color: rgb(0.4, 0.4, 0.4) }
        );

        // --- Geometry ---
        const left = PAGE.margin + AXIS_WIDTH;
        const gridWidth = PAGE.width - PAGE.margin - left;
        const colWidth = gridWidth / days.length;

        const headerTop = titleY - 24;
        const allDayTop = headerTop - HEADER_HEIGHT;

        const events = items.filter(i => i.kind === 'event');
        const allDayEvents = events.filter(e => e.allDay);
        const timedEvents = events.filter(e => !e.allDay);

        const allDayRows = PdfPrinter.countAllDayRows(allDayEvents, days);
        const allDayHeight = allDayRows * ALL_DAY_ROW_HEIGHT;

        const gridTop = allDayTop - allDayHeight;
        const gridBottom = PAGE.margin;
        const gridHeight = gridTop - gridBottom;

        const yAt = minutes => gridTop - ((minutes - minMin) / span) * gridHeight;
        const colX = i => left + i * colWidth;

        // --- Day headers ---
        days.forEach((day, i) => {
            const label = PdfPrinter.safe(`${day.format('ddd')} ${day.format(dateFormat)}`);
            const w = fontBold.widthOfTextAtSize(label, 9);

            page.drawText(label, {
                x: colX(i) + (colWidth - w) / 2,
                y: headerTop - 14,
                size: 9,
                font: fontBold,
            });
        });

        // --- Shaded areas (background) ---
        items
            .filter(i => i.kind === 'nonWorking' && dayIndex[i.day] !== undefined)
            .forEach(item => {
                const idx = dayIndex[item.day];
                const dayStart = days[idx];
                const a = Math.max(item.start.diff(dayStart, 'minutes', true), minMin);
                const b = Math.min(item.end.diff(dayStart, 'minutes', true), maxMin);

                if (b <= a) {
                    return;
                }

                const color = item.color || FALLBACK_COLOR;

                page.drawRectangle({
                    x: colX(idx),
                    y: yAt(b),
                    width: colWidth,
                    height: yAt(a) - yAt(b),
                    color: rgb(color.rgb.r, color.rgb.g, color.rgb.b),
                    opacity: color.opacity * NON_WORKING_OPACITY_SCALE,
                });
            });

        // --- Hour lines + axis ---
        for (let m = Math.ceil(minMin / 60) * 60; m <= maxMin; m += 60) {
            const y = yAt(m);

            page.drawLine({
                start: { x: left, y },
                end: { x: left + gridWidth, y },
                thickness: 0.4,
                color: rgb(0.8, 0.8, 0.8),
            });

            page.drawText(
                moment().startOf('day').add(m, 'minutes').format(timeFormat),
                {
                    x: PAGE.margin,
                    y: y - 3,
                    size: 7,
                    font,
                    color: rgb(0.4, 0.4, 0.4),
                }
            );
        }

        // --- Column separators ---
        for (let i = 0; i <= days.length; i++) {
            page.drawLine({
                start: { x: colX(i), y: headerTop },
                end: { x: colX(i), y: gridBottom },
                thickness: 0.5,
                color: rgb(0.6, 0.6, 0.6),
            });
        }

        // --- All-day events ---
        days.forEach((day, i) => {
            allDayEvents
                .filter(e => PdfPrinter.coversDay(e, day))
                .forEach((event, row) => {
                    PdfPrinter.drawEventBox(page, font, fontBold, event, {
                        x: colX(i) + 1,
                        y: allDayTop - (row + 1) * ALL_DAY_ROW_HEIGHT + 1,
                        width: colWidth - 2,
                        height: ALL_DAY_ROW_HEIGHT - 2,
                        showTime: false,
                        timeFormat,
                    });
                });
        });

        // --- Timed events ---
        days.forEach((day, i) => {
            const segments = [];

            timedEvents.forEach(event => {
                const end = event.end.isAfter(event.start) ? event.end : event.start.clone().add(30, 'minutes');
                const a = Math.max(event.start.diff(day, 'minutes', true), minMin);
                const b = Math.min(end.diff(day, 'minutes', true), maxMin);

                if (b > a) {
                    segments.push({ event, a, b, col: 0, cols: 1 });
                }
            });

            PdfPrinter.layoutColumns(segments);

            segments.forEach(seg => {
                const width = colWidth / seg.cols;
                const yTop = yAt(seg.a);
                const yBottom = yAt(seg.b);

                PdfPrinter.drawEventBox(page, font, fontBold, seg.event, {
                    x: colX(i) + seg.col * width + 1,
                    y: yBottom,
                    width: width - 2,
                    height: Math.max(yTop - yBottom, MIN_EVENT_HEIGHT),
                    showTime: true,
                    timeFormat,
                });
            });
        });

        const pdfBytes = await pdfDoc.save();
        PdfPrinter.download(pdfBytes, filename);
    }

    // ---------------------------------------------------------------- drawing

    /**
     * Draws a single event box (background, border, wrapped text,
     * optional strike-through for canceled events).
     *
     * @param {PDFPage} page - pdf-lib page to draw on.
     * @param {PDFFont} font - Regular font.
     * @param {PDFFont} fontBold - Bold font (used for the first line).
     * @param {object} event - Normalized event (`title`, `start`, `end`, `color`, `state`, `extra`, …).
     * @param {{x: number, y: number, width: number, height: number, showTime: boolean, timeFormat: string}} box
     * @returns {void}
     */
    static drawEventBox(page, font, fontBold, event, box) {
        const color = event.color || FALLBACK_COLOR;

        // Completed or canceled event: lightened background (blended with white).
        const amount = STATE_LIGHTEN[event.state] || 0;
        const lighten = c => c + (1 - c) * amount;

        const r = lighten(color.rgb.r);
        const g = lighten(color.rgb.g);
        const b = lighten(color.rgb.b);

        page.drawRectangle({
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            color: rgb(r, g, b),
            opacity: color.opacity,
            borderColor: rgb(r * 0.7, g * 0.7, b * 0.7),
            borderWidth: 0.5,
        });

        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        const textColor = luminance > 0.6 ? rgb(0, 0, 0) : rgb(1, 1, 1);

        let text = event.title || '(?)';

        if (box.showTime) {
            text = event.start.format(box.timeFormat) + ' ' + text;
        }

        if (event.extra && event.extra.place) {
            text += ' - ' + event.extra.place;
        }

        const size = 7;
        const lineHeight = size + 2;
        const padding = 2;
        const maxLines = Math.max(1, Math.floor((box.height - padding) / lineHeight));
        const lines = PdfPrinter.wrapText(PdfPrinter.safe(text), font, size, box.width - 2 * padding, maxLines);

        lines.forEach((line, i) => {
            const lineFont = i === 0 ? fontBold : font;
            const x = box.x + padding;
            const y = box.y + box.height - padding - size - i * lineHeight;

            page.drawText(line, { x, y, size, font: lineFont, color: textColor });

            // Canceled (Not Held, Canceled...): strike-through text.
            if (event.state === 'canceled') {
                const strikeY = y + size * 0.3;

                page.drawLine({
                    start: { x, y: strikeY },
                    end: { x: x + lineFont.widthOfTextAtSize(line, size), y: strikeY },
                    thickness: 0.7,
                    color: textColor,
                });
            }
        });
    }

    // ---------------------------------------------------------------- layout

    /**
     * Arranges overlapping segments side by side.
     * Mutates each segment in place, setting `col` and `cols`.
     *
     * @param {Array<{a: number, b: number, col: number, cols: number}>} segments
     * @returns {void}
     */
    static layoutColumns(segments) {
        segments.sort((x, y) => x.a - y.a || y.b - x.b);

        let cluster = [];
        let clusterEnd = -Infinity;

        const flush = () => {
            const cols = Math.max(...cluster.map(s => s.col)) + 1;
            cluster.forEach(s => s.cols = cols);
            cluster = [];
        };

        for (const seg of segments) {
            if (cluster.length && seg.a >= clusterEnd) {
                flush();
                clusterEnd = -Infinity;
            }

            let col = 0;

            while (cluster.some(s => s.col === col && s.b > seg.a)) {
                col++;
            }

            seg.col = col;
            cluster.push(seg);
            clusterEnd = Math.max(clusterEnd, seg.b);
        }

        if (cluster.length) {
            flush();
        }
    }

    /**
     * Returns the maximum number of all-day events visible on a single day,
     * i.e. the number of all-day rows needed.
     *
     * @param {Array<object>} allDayEvents
     * @param {moment.Moment[]} days
     * @returns {number}
     */
    static countAllDayRows(allDayEvents, days) {
        return Math.max(
            0,
            ...days.map(day => allDayEvents.filter(e => PdfPrinter.coversDay(e, day)).length)
        );
    }

    /**
     * Returns the list of days covered by the given period.
     *
     * @param {{start: moment.Moment, end: moment.Moment}} period
     * @returns {moment.Moment[]}
     */
    static getDays(period) {
        const days = [];

        for (const d = moment(period.start).startOf('day'); d.isBefore(period.end); d.add(1, 'day')) {
            days.push(d.clone());
        }

        return days;
    }

    // ---------------------------------------------------------------- utils

    /**
     * An "all-day" event covers a day if that day is in `[start, end[`.
     * Only dates matter; hours are ignored (same as FullCalendar).
     *
     * @param {{start: moment.Moment, end: moment.Moment}} event
     * @param {moment.Moment} day
     * @returns {boolean}
     */
    static coversDay(event, day) {
        const startDay = event.start.clone().startOf('day');
        let endDay = event.end.clone().startOf('day');

        if (!endDay.isAfter(startDay)) {
            endDay = startDay.clone().add(1, 'day');
        }

        return !day.isBefore(startDay) && day.isBefore(endDay);
    }

    /**
     * Converts a duration string to minutes: `"08:00:00"` → `480`.
     * Returns `fallback` if the input is missing or invalid.
     *
     * @param {string|null|undefined} value
     * @param {number} fallback
     * @returns {number}
     */
    static toMinutes(value, fallback) {
        if (!value) {
            return fallback;
        }

        const minutes = moment.duration(value).asMinutes();

        return isNaN(minutes) ? fallback : minutes;
    }

    /**
     * Helvetica (WinAnsi) crashes on characters outside Latin-1: they are replaced.
     *
     * @param {*} text
     * @returns {string}
     */
    static safe(text) {
        return String(text).replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u20AC]/g, '?');
    }

    /**
     * Wraps `text` into lines that fit within `maxWidth`, limited to `maxLines`.
     * Adds an ellipsis if the text is truncated and hard-truncates words that
     * are too long to fit.
     *
     * @param {string} text
     * @param {PDFFont} font
     * @param {number} size
     * @param {number} maxWidth
     * @param {number} maxLines
     * @returns {string[]}
     */
    static wrapText(text, font, size, maxWidth, maxLines) {
        const words = text.split(/\s+/);
        const lines = [];
        let current = '';

        for (const word of words) {
            const candidate = current ? current + ' ' + word : word;

            if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
                current = candidate;
            } else {
                lines.push(current);
                current = word;
            }
        }

        if (current) {
            lines.push(current);
        }

        if (lines.length > maxLines) {
            lines.length = maxLines;
            lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,3}$/, '') + '...';
        }

        // Word too long for the width: hard-truncate it.
        return lines.map(line => {
            while (line.length > 1 && font.widthOfTextAtSize(line, size) > maxWidth) {
                line = line.slice(0, -1);
            }

            return line;
        });
    }

    /**
     * Triggers a browser download of the given PDF bytes.
     *
     * @param {Uint8Array} pdfBytes
     * @param {string} filename
     * @returns {void}
     */
    static download(pdfBytes, filename) {
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();

        URL.revokeObjectURL(url);
    }
}
