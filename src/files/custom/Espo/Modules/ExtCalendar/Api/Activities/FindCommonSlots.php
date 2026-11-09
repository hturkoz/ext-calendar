<?php

namespace Espo\Modules\ExtCalendar\Api\Activities;

use DateTimeImmutable;
use DateTimeZone;
use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Core\Field\DateTime;
use Espo\Core\Utils\Config;
use Espo\Modules\Crm\Tools\Calendar\Service;

/**
 * Finds the time ranges where all the given users are free at the same time.
 *
 * Request body: userIdList (string[]), from, to (UTC 'Y-m-d H:i:s'), duration (minutes,
 * default 60), period ('AM'|'PM'|null), timeZone (IANA name, used to evaluate AM/PM).
 *
 * Each returned slot is a whole continuous free range at least `duration` minutes long.
 * Both busy ranges and non-working ranges returned by the calendar service are treated
 * as unavailable.
 */
class FindCommonSlots implements Action
{
    private const DATE_FORMAT = 'Y-m-d H:i:s';

    public function __construct(
        private Service $service,
        private Config $config
    ) {}

    public function process(Request $request): Response
    {
        $data = $request->getParsedBody();

        $userIdList = array_values(array_unique(array_filter(
            (array) ($data->userIdList ?? []),
            'is_string'
        )));

        $from = $data->from ?? null;
        $to = $data->to ?? null;
        $duration = max(1, (int) ($data->duration ?? 60));
        $period = $this->normalizePeriod($data->period ?? null);

        if (!$userIdList) {
            return ResponseComposer::json(['error' => 'userIdList is required']);
        }

        $fromTs = is_string($from) ? $this->toTimestamp($from) : null;
        $toTs = is_string($to) ? $this->toTimestamp($to) : null;

        if ($fromTs === null || $toTs === null) {
            return ResponseComposer::json(['error' => 'from and to dates are required']);
        }

        if ($toTs <= $fromTs) {
            return ResponseComposer::json(['error' => 'to must be after from']);
        }

        $busyRanges = $this->service->fetchBusyRangesForUsers(
            $userIdList,
            DateTime::fromString($from),
            DateTime::fromString($to)
        );

        $busy = $this->mergeIntervals(
            $this->collectBusyIntervals($userIdList, $busyRanges, $fromTs, $toTs)
        );

        $free = $this->getFreeIntervals($busy, $fromTs, $toTs);

        if ($period) {
            $free = $this->applyPeriod($free, $period, $this->getTimeZone($data->timeZone ?? null));
        }

        return ResponseComposer::json([
            'commonSlots' => $this->buildSlots($free, $duration),
            'userIdList' => $userIdList,
            'duration' => $duration,
        ]);
    }

    /**
     * Busy and non-working ranges of all users, clipped to [$fromTs, $toTs].
     *
     * @param string[] $userIdList
     * @param array<string, object[]> $busyRanges Ranges keyed by user ID.
     * @return array<int, array{int, int}> Intervals as [start, end] timestamps.
     */
    private function collectBusyIntervals(array $userIdList, array $busyRanges, int $fromTs, int $toTs): array
    {
        $intervals = [];

        foreach ($userIdList as $userId) {
            foreach ($busyRanges[$userId] ?? [] as $range) {
                $raw = $range->getRaw();

                $start = $this->toTimestamp($raw->dateStart);
                $end = $this->toTimestamp($raw->dateEnd);

                if ($start === null || $end === null) {
                    continue;
                }

                $start = max($start, $fromTs);
                $end = min($end, $toTs);

                if ($end > $start) {
                    $intervals[] = [$start, $end];
                }
            }
        }

        return $intervals;
    }

    /**
     * Sorts the intervals and merges those that overlap or touch.
     *
     * @param array<int, array{int, int}> $intervals
     * @return array<int, array{int, int}>
     */
    private function mergeIntervals(array $intervals): array
    {
        usort($intervals, fn (array $a, array $b) => $a[0] <=> $b[0]);

        $merged = [];

        foreach ($intervals as [$start, $end]) {
            $last = count($merged) - 1;

            if ($last >= 0 && $start <= $merged[$last][1]) {
                $merged[$last][1] = max($merged[$last][1], $end);

                continue;
            }

            $merged[] = [$start, $end];
        }

        return $merged;
    }

    /**
     * Complement of the merged busy intervals within [$fromTs, $toTs].
     *
     * @param array<int, array{int, int}> $busy Merged and sorted.
     * @return array<int, array{int, int}>
     */
    private function getFreeIntervals(array $busy, int $fromTs, int $toTs): array
    {
        $free = [];
        $cursor = $fromTs;

        foreach ($busy as [$start, $end]) {
            if ($start > $cursor) {
                $free[] = [$cursor, $start];
            }

            $cursor = max($cursor, $end);
        }

        if ($cursor < $toTs) {
            $free[] = [$cursor, $toTs];
        }

        return $free;
    }

    /**
     * Keeps only the morning (before 12:00) or afternoon (from 12:00) part of each free
     * interval, day by day, in the given time zone.
     *
     * @param array<int, array{int, int}> $intervals
     * @param 'AM'|'PM' $period
     * @return array<int, array{int, int}>
     */
    private function applyPeriod(array $intervals, string $period, DateTimeZone $timeZone): array
    {
        $result = [];

        foreach ($intervals as [$start, $end]) {
            $day = (new DateTimeImmutable('@' . $start))
                ->setTimezone($timeZone)
                ->setTime(0, 0);

            while ($day->getTimestamp() < $end) {
                $next = $day->modify('+1 day');
                $noon = $day->setTime(12, 0)->getTimestamp();

                [$windowStart, $windowEnd] = $period === 'AM' ?
                    [$day->getTimestamp(), $noon] :
                    [$noon, $next->getTimestamp()];

                $from = max($start, $windowStart);
                $to = min($end, $windowEnd);

                if ($to > $from) {
                    $result[] = [$from, $to];
                }

                $day = $next;
            }
        }

        return $result;
    }

    /**
     * Keeps the intervals long enough for the requested duration.
     * Each slot is returned whole: a 3-hour range stays one 3-hour slot.
     *
     * @param array<int, array{int, int}> $intervals
     * @return array<int, array{start: string, end: string, duration: int}>
     */
    private function buildSlots(array $intervals, int $duration): array
    {
        $slots = [];
        $minLength = $duration * 60;

        foreach ($intervals as [$start, $end]) {
            if ($end - $start < $minLength) {
                continue;
            }

            $slots[] = [
                'start' => gmdate(self::DATE_FORMAT, $start),
                'end' => gmdate(self::DATE_FORMAT, $end),
                'duration' => $duration,
            ];
        }

        return $slots;
    }

    private function normalizePeriod(mixed $value): ?string
    {
        $value = is_string($value) ? strtoupper($value) : null;

        return in_array($value, ['AM', 'PM'], true) ? $value : null;
    }

    /**
     * The requested time zone, otherwise the system one, otherwise UTC.
     */
    private function getTimeZone(mixed $requested): DateTimeZone
    {
        foreach ([$requested, $this->config->get('timeZone')] as $name) {
            if (!is_string($name) || $name === '') {
                continue;
            }

            try {
                return new DateTimeZone($name);
            } catch (\Exception) {
                // Invalid name, try the next one.
            }
        }

        return new DateTimeZone('UTC');
    }

    /**
     * @param string $value Date-time in UTC (internal format).
     * @return int|null Null if the value cannot be parsed.
     */
    private function toTimestamp(string $value): ?int
    {
        try {
            return (new DateTimeImmutable($value, new DateTimeZone('UTC')))->getTimestamp();
        } catch (\Exception) {
            return null;
        }
    }
}
