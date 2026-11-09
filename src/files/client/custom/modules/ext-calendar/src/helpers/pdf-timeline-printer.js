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

/** @module ext-calendar:helpers/pdf-timeline-printer */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import PdfPrinter from 'ext-calendar:helpers/pdf-printer';

/**
 * Default page settings (A4 landscape).
 *
 * @type {{width: number, height: number, margin: number}}
 */
const DEFAULT_PAGE = { width: 842, height: 595, margin: 30 }; // A4 landscape

/** Width in points of the left column holding group labels. */
const LABEL_WIDTH = 90;

/** Minimum height in points of a group row. */
const MIN_ROW_HEIGHT = 28;

/** Minimum height in points of a single event lane within a row. */
const LANE_MIN_HEIGHT = 14;

/** Minimum width in points of an event box. */
const MIN_EVENT_WIDTH = 4;

/** Minimum spacing in points between two hour labels on the axis. */
const MIN_LABEL_SPACING = 40;

/** Day key format used to match non-working ranges to a specific day. */
const DAY_KEY = 'YYYY-MM-DD';

/**
 * Non-working areas are lightened on print
 * (0 = invisible, 1 = on-screen color).
 */
const NON_WORKING_OPACITY_SCALE = 0.4;

/**
 * Fallback color used when a non-working range has no color defined.
 *
 * @type {{rgb: {r: number, g: number, b: number}, opacity: number}}
 */
const FALLBACK_NON_WORKING = { rgb: { r: 0.2, g: 0.23, b: 0.29 }, opacity: 0.7 };

/**
 * Renders a timeline (per-user rows, time axis) to a PDF document.
 */
export default class PdfTimelinePrinter {

    /**
     * Builds and downloads the timeline PDF.
     *
     * @param {object} options
     * @param {string} options.title - Document title, printed on every page.
     * @param {{start: moment.Moment, end: moment.Moment}} options.period - Range of days to render.
     * @param {{id: string, label: string}[]} options.groups - Rows (users), in display order.
     * @param {Array<object>} options.items - Result of `CalendarNormalizer.normalizeTimeline().items`.
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
            groups,
            items,
            slotMinTime,
            slotMaxTime,
            pageFormat,
            margin,
            dateFormat,
            timeFormat,
            filename = 'calendar-timeline.pdf',
        } = options;

        if (!dateFormat || !timeFormat) {
            throw new Error('PdfTimelinePrinter: dateFormat and timeFormat are required (user preferences).');
        }

        const pdfDoc = await PDFDocument.create();

        const ctx = {
            pdfDoc,
            font: await pdfDoc.embedFont(StandardFonts.Helvetica),
            fontBold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
            title,
            groups,
            pageFormat,
            margin,
            dateFormat,
            timeFormat,
            events: items.filter(i => i.kind === 'event'),
            nonWorking: items.filter(i => i.kind === 'nonWorking'),
            minMin: PdfPrinter.toMinutes(slotMinTime, 0),
            maxMin: PdfPrinter.toMinutes(slotMaxTime, 24 * 60),
        };

        PdfPrinter.getDays(period).forEach(day => PdfTimelinePrinter.drawDay(ctx, day));

        PdfPrinter.download(await pdfDoc.save(), filename);
    }

    /**
     * Renders a single day: one or more pages (header is repeated
     * if the group rows overflow the page height).
     *
     * @param {object} ctx - Rendering context built by `print()`.
     * @param {moment.Moment} day - The day to render (its start of day is used as origin).
     * @returns {void}
     */
    static drawDay(ctx, day) {
        const { pdfDoc, font, fontBold, groups, events, nonWorking, minMin, maxMin, title, pageFormat, margin, dateFormat, timeFormat } = ctx;

        const PAGE = {
            width: Array.isArray(pageFormat) ? pageFormat[0] : DEFAULT_PAGE.width,
            height: Array.isArray(pageFormat) ? pageFormat[1] : DEFAULT_PAGE.height,
            margin: (typeof margin === 'number' && margin >= 0) ? margin : DEFAULT_PAGE.margin,
        };

        const span = maxMin - minMin;
        const left = PAGE.margin + LABEL_WIDTH;
        const gridWidth = PAGE.width - PAGE.margin - left;
        const xAt = minutes => left + ((minutes - minMin) / span) * gridWidth;

        const dayStart = day.clone();
        const dayKey = day.format(DAY_KEY);

        let page = null;
        let y = 0;

        const newPage = () => {
            page = pdfDoc.addPage([PAGE.width, PAGE.height]);

            const titleY = PAGE.height - PAGE.margin - 14;

            page.drawText(PdfPrinter.safe(title), { x: PAGE.margin, y: titleY, size: 16, font: fontBold });
            page.drawText(
                PdfPrinter.safe(`${day.format('dddd')} ${day.format(dateFormat)}`),
                { x: PAGE.margin, y: titleY - 14, size: 10, font, color: rgb(0.4, 0.4, 0.4) }
            );

            // Hour axis: labels are spaced so they do not overlap.
            const axisY = titleY - 32;
            const hourWidth = gridWidth / (span / 60);
            const step = Math.max(1, Math.ceil(MIN_LABEL_SPACING / hourWidth));

            for (let m = Math.ceil(minMin / 60) * 60; m <= maxMin; m += 60 * step) {
                const label = moment().startOf('day').add(m, 'minutes').format(timeFormat);
                const w = font.widthOfTextAtSize(label, 7);

                page.drawText(label, { x: xAt(m) - w / 2, y: axisY, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
            }

            y = axisY - 6;

            page.drawLine({
                start: { x: PAGE.margin, y },
                end: { x: PAGE.width - PAGE.margin, y },
                thickness: 0.5,
                color: rgb(0.6, 0.6, 0.6),
            });
        };

        newPage();

        for (const group of groups) {
            // Events of this row for this day, in minutes since midnight.
            const segments = [];

            events
                .filter(e => e.group === group.id)
                .forEach(event => {
                    const a = Math.max(event.start.diff(dayStart, 'minutes', true), minMin);
                    const b = Math.min(event.end.diff(dayStart, 'minutes', true), maxMin);

                    if (b > a) {
                        segments.push({ event, a, b, col: 0, cols: 1 });
                    }
                });

            // Simultaneous events: stacked in "lanes" within the row height.
            PdfPrinter.layoutColumns(segments);

            const lanes = Math.max(1, ...segments.map(s => s.cols));
            const rowHeight = Math.max(MIN_ROW_HEIGHT, lanes * LANE_MIN_HEIGHT);

            if (y - rowHeight < PAGE.margin) {
                newPage();
            }

            // Non-working areas of this user (background).
            nonWorking
                .filter(n => n.group === group.id && n.day === dayKey)
                .forEach(n => {
                    const a = Math.max(n.start.diff(dayStart, 'minutes', true), minMin);
                    const b = Math.min(n.end.diff(dayStart, 'minutes', true), maxMin);

                    if (b <= a) {
                        return;
                    }

                    const color = n.color || FALLBACK_NON_WORKING;

                    page.drawRectangle({
                        x: xAt(a),
                        y: y - rowHeight,
                        width: xAt(b) - xAt(a),
                        height: rowHeight,
                        color: rgb(color.rgb.r, color.rgb.g, color.rgb.b),
                        opacity: color.opacity * NON_WORKING_OPACITY_SCALE,
                    });
                });

            // Hour lines.
            for (let m = Math.ceil(minMin / 60) * 60; m <= maxMin; m += 60) {
                page.drawLine({
                    start: { x: xAt(m), y },
                    end: { x: xAt(m), y: y - rowHeight },
                    thickness: 0.3,
                    color: rgb(0.8, 0.8, 0.8),
                });
            }

            // Row label (user name).
            PdfPrinter
                .wrapText(PdfPrinter.safe(group.label), fontBold, 8, LABEL_WIDTH - 8, 2)
                .forEach((line, i) => {
                    page.drawText(line, { x: PAGE.margin + 2, y: y - 11 - i * 10, size: 8, font: fontBold });
                });

            // Events.
            segments.forEach(seg => {
                const laneHeight = rowHeight / seg.cols;
                const x = xAt(seg.a);

                PdfPrinter.drawEventBox(page, font, fontBold, seg.event, {
                    x: x + 0.5,
                    y: y - (seg.col + 1) * laneHeight + 0.5,
                    width: Math.max(xAt(seg.b) - x, MIN_EVENT_WIDTH) - 1,
                    height: laneHeight - 1,
                    showTime: true,
                    timeFormat,
                });
            });

            // Separators: row bottom + label column.
            page.drawLine({
                start: { x: PAGE.margin, y: y - rowHeight },
                end: { x: PAGE.width - PAGE.margin, y: y - rowHeight },
                thickness: 0.5,
                color: rgb(0.7, 0.7, 0.7),
            });

            page.drawLine({
                start: { x: left, y },
                end: { x: left, y: y - rowHeight },
                thickness: 0.5,
                color: rgb(0.6, 0.6, 0.6),
            });

            y -= rowHeight;
        }
    }
}