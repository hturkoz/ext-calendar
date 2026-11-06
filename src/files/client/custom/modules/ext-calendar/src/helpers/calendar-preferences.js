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
 * Lit les préférences de calendrier de l'utilisateur.
 * Retourne null pour une valeur non définie ou invalide,
 * afin de garder le comportement par défaut du core.
 */
export default class CalendarPreferences {

    /**
     * @param {import('models/preferences').default} preferences
     */
    constructor(preferences) {

        const from = this.#toHour(preferences.get('slotFrom'));
        const to = this.#toHour(preferences.get('slotTo'));

        /** @type {boolean} */
        this.showWeekends = preferences.get('showWeekends') !== false;

        const rangeIsValid = from !== null && to !== null && from < to;

        /** @type {number|null} */
        this.slotFrom = rangeIsValid ? from : null;
        /** @type {number|null} */
        this.slotTo = rangeIsValid ? to : null;
    }

    /** @return {string|null} ex. "08:00:00" */
    getSlotMinTime() {
        return this.slotFrom === null ? null : this.#format(this.slotFrom);
    }

    /** @return {string|null} ex. "24:00:00" */
    getSlotMaxTime() {
        return this.slotTo === null ? null : this.#format(this.slotTo);
    }

    /**
     * @param {string|null|undefined} value ex. "08:00"
     * @return {number|null}
     */
    #toHour(value) {
        const hour = parseInt(value ?? '');

        return isNaN(hour) ? null : hour;
    }

    /** @param {number} hour */
    #format(hour) {
        return String(hour).padStart(2, '0') + ':00:00';
    }
}
