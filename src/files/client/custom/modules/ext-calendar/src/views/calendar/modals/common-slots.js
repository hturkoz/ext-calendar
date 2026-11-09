import Dep from 'views/modal';
import Model from 'model';
import EditForModalRecordView from 'views/record/edit-for-modal';
import CalendarUsersFieldView from 'crm:views/calendar/fields/users';
import EnumFieldView from 'views/fields/enum';
import DateFieldView from 'views/fields/date';
import CalendarPreferences from 'ext-calendar:helpers/calendar-preferences';

/** Default length of the search range, in days. */
const DEFAULT_RANGE_DAYS = 7;

/**
 * Modal view for finding common meeting slots between users.
 *
 * @extends Dep
 */
export default class CommonSlotsModal extends Dep {
    /**
     * @type {string}
     */
    templateContent = `
        <div class="record-container no-side-margin">{{{record}}}</div>
    `;

    /**
     * @type {string}
     */
    className = 'dialog dialog-record';

    /**
     * @type {boolean}
     */
    backdrop = true;

    /**
     * Sets up the modal: buttons, header, model defaults, record view, and listeners.
     */
    setup() {
        this.prefs = new CalendarPreferences(this.getPreferences());

        this.buttonList = [
            {
                name: 'find',
                label: 'Find Common Slots',
                style: 'primary',
                onClick: () => this.actionFind(),
            },
            {
                name: 'cancel',
                label: 'Cancel',
                onClick: () => this.close(),
            }
        ];

        this.headerText = this.translate('Find Common Meeting Slots', 'labels', 'Calendar');

        this.model = new Model();

        this.model.set('duration', 60);
        this.model.set('period', '');

        const dateFrom = this.getDefaultDateFrom();

        this.model.set('dateFrom', dateFrom);
        this.model.set('dateTo', this.getDefaultDateTo(dateFrom));

        this.model.set('usersIds', [this.getUser().id]);
        const usersNames = {};
        usersNames[this.getUser().id] = this.getUser().get('name');
        this.model.set('usersNames', usersNames);

        this.recordView = new EditForModalRecordView({
            model: this.model,
            detailLayout: [
                {
                    rows: [
                        [
                            {
                                view: new CalendarUsersFieldView({
                                    name: 'users',
                                    labelText: this.translate('Users', 'labels', 'Calendar'),
                                    params: {
                                        required: true
                                    }
                                }),
                            },
                            false
                        ],
                        [
                            {
                                view: new EnumFieldView({
                                    name: 'duration',
                                    labelText: this.translate('Duration', 'fields', 'Meeting'),
                                    params: {
                                        options: [15, 30, 45, 60, 90, 120, 180, 240, 480],
                                        translation: 'Meeting.options.duration',
                                        required: true
                                    }
                                }),
                            },
                            {
                                view: new EnumFieldView({
                                    name: 'period',
                                    labelText: this.translate('Period', 'labels', 'Calendar'),
                                    params: {
                                        options: ['', 'AM', 'PM'],
                                        translation: 'Calendar.options.period'
                                    }
                                }),
                            }
                        ],
                        [
                            {
                                view: new DateFieldView({
                                    name: 'dateFrom',
                                    labelText: this.translate('Date Start', 'fields', 'Meeting'),
                                    params: {
                                        required: true
                                    }
                                }),
                            },
                            {
                                view: new DateFieldView({
                                    name: 'dateTo',
                                    labelText: this.translate('Date End', 'fields', 'Meeting'),
                                    params: {
                                        required: true
                                    }
                                }),
                            }
                        ]
                    ]
                }
            ]
        });

        this.assignView('record', this.recordView);

        this.listenTo(this.model, 'change:dateFrom', (model, value, options) => {
            if (!options.ui) {
                return; // Only react to user changes
            }

            const dateFrom = this.model.get('dateFrom');

            if (!dateFrom) {
                return;
            }

            this.model.set('dateTo', this.getDefaultDateTo(dateFrom), { ui: true });
        });
    }

    /**
     * Default search start: tomorrow, skipping Saturday and Sunday when the user hides
     * weekends in the calendar preferences. Non-working days of the working time calendar
     * and busy periods are excluded by the search itself.
     *
     * @private
     * @return {string} Date in the 'YYYY-MM-DD' format.
     */
    getDefaultDateFrom() {
        const date = moment().add(1, 'day');

        if (!this.prefs.showWeekends) {
            while (date.isoWeekday() > 5) {
                date.add(1, 'day');
            }
        }

        return date.format('YYYY-MM-DD');
    }

    /**
     * @private
     * @param {string} dateFrom Date in the 'YYYY-MM-DD' format.
     * @return {string} Date in the 'YYYY-MM-DD' format.
     */
    getDefaultDateTo(dateFrom) {
        return moment(dateFrom).add(DEFAULT_RANGE_DAYS, 'days').format('YYYY-MM-DD');
    }

    /**
     * Search range as UTC date-times: from the first slot hour of the start day to the
     * last slot hour of the end day (user preferences), never earlier than now.
     *
     * @private
     * @param {string} dateFrom Date in the 'YYYY-MM-DD' format.
     * @param {string} dateTo Date in the 'YYYY-MM-DD' format.
     * @return {{from: string, to: string}} UTC date-times, internal format.
     */
    getSearchRange(dateFrom, dateTo) {
        const timeZone = this.getDateTime().getTimeZone();
        const format = this.getDateTime().internalDateTimeFormat;

        const minTime = moment.duration(this.prefs.getSlotMinTime() || '00:00:00');
        const maxTime = moment.duration(this.prefs.getSlotMaxTime() || '24:00:00');

        const from = moment.max(moment.tz(dateFrom, timeZone).add(minTime), moment());
        const to = moment.tz(dateTo, timeZone).add(maxTime);

        return {
            from: from.clone().utc().format(format),
            to: to.clone().utc().format(format),
        };
    }

    /**
     * Validates the form, collects input data, and requests common slots from the backend.
     * On success, triggers 'slots-found' event with results and closes the modal.
     */
    actionFind() {
        if (this.recordView.validate()) {
            return;
        }

        const data = this.recordView.fetch();
        const userIds = data.usersIds || [];
        const duration = data.duration;
        const period = data.period || null;
        const dateFrom = data.dateFrom;
        const dateTo = data.dateTo;

        if (!userIds.length) {
            Espo.Ui.error(this.translate('Please select users', 'messages', 'Calendar'));
            return;
        }

        if (moment(dateTo).isBefore(moment(dateFrom))) {
            Espo.Ui.error(this.translate('End date must be after start date', 'messages', 'Calendar'));
            return;
        }

        const {from, to} = this.getSearchRange(dateFrom, dateTo);

        if (!moment.utc(to).isAfter(moment.utc(from))) {
            Espo.Ui.error(this.translate('End date must be after start date', 'messages', 'Calendar'));
            return;
        }

        this.disableButton('find');
        Espo.Ui.notify(this.translate('Loading...'));

        Espo.Ajax.postRequest('Activities/findCommonSlots', {
            userIdList: userIds,
            duration: parseInt(duration),
            period: period,
            from: from,
            to: to,
            timeZone: this.getDateTime().getTimeZone(),
        })
            .then(result => {
                // The API reports validation errors in the body, with a 200 status.
                if (result.error) {
                    Espo.Ui.error(result.error);
                    this.enableButton('find');

                    return;
                }

                Espo.Ui.notify(false);

                this.trigger('slots-found', {
                    commonSlots: result.commonSlots,
                    userIdList: userIds,
                    userNames: data.usersNames || {},
                    duration: duration,
                    dateFrom: dateFrom,
                    dateTo: dateTo
                });

                this.close();
            })
            .catch(error => {
                console.error('Error finding common slots:', error);
                Espo.Ui.error('Error finding common slots');
                this.enableButton('find');
            });
    }
}