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

import PreferencesEditView from 'views/preferences/record/edit';

/**
 * @typedef {Object} LayoutPanel
 * @property {string} [name]
 * @property {boolean} [tabBreak]
 * @property {string} [tabLabel]
 * @property {Array<Array<{name: string} | false>>} rows
 */

export default class extends PreferencesEditView {

    setup() {
        // Doit être activé avant super.setup(), qui construit le layout.
        this.hasModifyDetailLayout = true;

        super.setup();

    }

    /**
     * @param {LayoutPanel[]} layout Déjà cloné par le core.
     */
    modifyDetailLayout(layout) {
        if (layout.some(panel => panel.name === 'extCalendarSettings')) {
            return;
        }
        
        layout.push({
            tabBreak: true,
            tabLabel: '$label:Extended Calendar',
            name: 'extCalendarSettings',
            rows: [
                [{name:'showWeekends'}, {name: 'slotFrom'}, {name: 'slotTo'}],
                [{name: 'calendarPageFormat'}, {name: 'calendarLayout'},{name: 'calendarMargin'} ],
                [{name: 'timelinePageFormat'}, {name: 'timelineLayout'},{name: 'timelineMargin'} ]
            ]
        });
        
    }

    /**
     * @return {boolean} true si invalide.
     */
    validate() {
        let notValid = super.validate();

        const from = parseInt(this.model.get('slotFrom'));
        const to = parseInt(this.model.get('slotTo'));

        if (!isNaN(from) && !isNaN(to) && from >= to) {
            const message = this.translate('slotFromMustBeBeforeSlotTo', 'messages', 'Preferences');
            const fieldView = this.getFieldView('hourTo');

            if (fieldView) {
                fieldView.showValidationMessage(message);
            }

            notValid = true;
        }

        return notValid;
    }
}