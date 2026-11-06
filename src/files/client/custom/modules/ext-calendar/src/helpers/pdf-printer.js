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

/** @module ext-calendar:helpers/pdf-printer */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Génère et télécharge un PDF à partir d'un ensemble d'événements.
 *
 * Utilisé par les vues calendar et timeline pour le bouton "Print".
 */
export default class PdfPrinter {

    /**
     * @param {object} options
     * @param {string} options.title
     * @param {Array<{title: string, start: Date, end: Date, allDay: boolean}>} options.events
     * @param {string} [options.filename]
     * @param {string} [options.dateFormat] ex. "DD/MM/YYYY"
     */
    static async print(options) {
        const {
            title,
            events,
            filename = 'calendar.pdf',
            dateFormat = 'DD/MM/YYYY',
        } = options;

        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        const pageWidth = 842;
        const pageHeight = 595;
        const margin = 40;

        let page = pdfDoc.addPage([pageWidth, pageHeight]);
        let y = pageHeight - margin;

        // Titre
        page.drawText(title, {
            x: margin,
            y: y,
            size: 18,
            font: fontBold,
            color: rgb(0, 0, 0),
        });

        y -= 30;

        // Ligne de séparation
        page.drawLine({
            start: { x: margin, y },
            end: { x: pageWidth - margin, y },
            thickness: 1,
            color: rgb(0.7, 0.7, 0.7),
        });

        y -= 20;

        // Liste des événements
        const lineHeight = 16;
        const bottomLimit = margin;

        for (const event of events) {
            if (y < bottomLimit + lineHeight) {
                page = pdfDoc.addPage([pageWidth, pageHeight]);
                y = pageHeight - margin;
            }

            const startStr = event.start
                ? PdfPrinter.formatDate(event.start, dateFormat, event.allDay)
                : '—';

            const line = `${startStr}   ${event.title || '(sans titre)'}`;

            page.drawText(line, {
                x: margin,
                y,
                size: 11,
                font,
                color: rgb(0, 0, 0),
            });

            y -= lineHeight;
        }

        // Téléchargement
        const pdfBytes = await pdfDoc.save();
        PdfPrinter.download(pdfBytes, filename);
    }

    /**
     * @param {Date} date
     * @param {string} format
     * @param {boolean} allDay
     * @return {string}
     */
    static formatDate(date, format, allDay) {
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();

        const datePart = format
            .replace('DD', dd)
            .replace('MM', mm)
            .replace('YYYY', yyyy);

        if (allDay) {
            return datePart;
        }

        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');

        return `${datePart} ${hh}:${min}`;
    }

    /**
     * @param {Uint8Array} pdfBytes
     * @param {string} filename
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
