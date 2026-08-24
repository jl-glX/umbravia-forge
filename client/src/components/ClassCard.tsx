import { useEffect, useState } from "react";
import {
  Users,
  User,
  Clock,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { formatDate, formatTime, isFutureClass } from "../lib/dateUtils";
import { useTranslation } from "react-i18next";
import { localizeClass } from "../lib/classLocalization";
import { Link } from "react-router-dom";

interface ClassCardProps {
  id: string;
  name: string;
  description: string;
  trainerName: string;
  scheduledAt: number;
  maxCapacity: number;
  bookedCount: number;
  availablePlaces: number;
  waitlistCount: number;
  bookingOpensAt: number | null;
  bookingClosesAt: number | null;
  onBookClick: () => void;
  isBooked: boolean;
  isLoading?: boolean;
}

export function ClassCard({
  id,
  name,
  description,
  trainerName,
  scheduledAt,
  maxCapacity,
  bookedCount,
  availablePlaces,
  waitlistCount,
  bookingOpensAt,
  bookingClosesAt,
  onBookClick,
  isBooked,
  isLoading = false,
}: ClassCardProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!bookingOpensAt || bookingOpensAt <= Date.now()) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [bookingOpensAt]);
  const isFuture = isFutureClass(scheduledAt);
  const isFull = availablePlaces === 0;
  const waitingForBookingOpening = Boolean(
    bookingOpensAt && bookingOpensAt > now,
  );
  const bookingClosed = Boolean(bookingClosesAt && bookingClosesAt <= now);
  const countdownMilliseconds = Math.max(0, (bookingOpensAt ?? now) - now);
  const countdownDays = Math.floor(countdownMilliseconds / 86_400_000);
  const countdownHours = Math.floor(
    (countdownMilliseconds % 86_400_000) / 3_600_000,
  );
  const countdownMinutes = Math.floor(
    (countdownMilliseconds % 3_600_000) / 60_000,
  );
  const countdownSeconds = Math.floor((countdownMilliseconds % 60_000) / 1_000);
  const openingCountdown = [
    countdownDays > 0 ? `${countdownDays}d` : "",
    countdownHours > 0 || countdownDays > 0 ? `${countdownHours}h` : "",
    `${countdownMinutes}m`,
    `${countdownSeconds}s`,
  ]
    .filter(Boolean)
    .join(" ");
  const occupancy = Math.min(
    100,
    Math.round((bookedCount / maxCapacity) * 100),
  );
  const localizedClass = localizeClass(name, description, t);

  return (
    <Card className="group flex flex-col overflow-hidden border-slate-200/80 bg-white/95 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl hover:shadow-blue-950/8">
      <div className="h-1.5 bg-linear-to-r from-blue-600 via-indigo-500 to-cyan-400" />
      <div className="flex flex-1 flex-col space-y-5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-lg font-bold tracking-tight text-slate-950">
              {localizedClass.name}
            </h4>
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-600">
              {localizedClass.description}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${isFull ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}
          >
            {isFull
              ? t("common.waitlist")
              : t("classes.open", { count: availablePlaces })}
          </span>
        </div>

        <div className="space-y-3 text-sm text-slate-700">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
              <User size={15} />
            </span>
            <span>{trainerName}</span>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Clock size={15} />
            </span>
            <span>
              {formatDate(scheduledAt)} {t("common.at")}{" "}
              {formatTime(scheduledAt)}
            </span>
          </div>
        </div>

        <div className="mt-auto rounded-xl bg-slate-50 p-3.5">
          <div className="mb-2 flex items-center justify-between text-xs font-medium">
            <span className="flex items-center gap-1.5 text-slate-600">
              <Users size={14} /> {t("common.capacity")}
            </span>
            <span className="text-slate-900">
              {bookedCount} / {maxCapacity}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full transition-all ${isFull ? "bg-amber-500" : "bg-linear-to-r from-blue-600 to-cyan-500"}`}
              style={{ width: `${occupancy}%` }}
            />
          </div>
          {isFull && waitlistCount > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700">
              <AlertCircle size={14} />{" "}
              {t("classes.onWaitlist", { count: waitlistCount })}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-slate-100 p-4 pt-3">
        <Button asChild variant="ghost" className="mb-2 w-full rounded-xl">
          <Link to={`/classes/${id}/session-content`}>
            {t("classes.sessionContent")}
          </Link>
        </Button>
        {!isFuture ? (
          <Button disabled className="w-full rounded-xl" variant="outline">
            {t("classes.finished")}
          </Button>
        ) : waitingForBookingOpening ? (
          <Button disabled className="w-full rounded-xl" variant="outline">
            <Clock />
            {t("classes.bookingOpensIn", { value: openingCountdown })}
          </Button>
        ) : bookingClosed ? (
          <Button disabled className="w-full rounded-xl" variant="outline">
            {t("classes.bookingClosed")}
          </Button>
        ) : isBooked ? (
          <Button
            disabled
            className="w-full rounded-xl border-emerald-200 bg-emerald-50 text-emerald-700 opacity-100"
            variant="outline"
          >
            <CheckCircle2 /> {t("classes.booked")}
          </Button>
        ) : isFull ? (
          <Button
            onClick={onBookClick}
            disabled={isLoading}
            className="w-full rounded-xl border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
            variant="outline"
          >
            {isLoading
              ? t("classes.joiningWaitlist")
              : t("classes.joinWaitlist")}
          </Button>
        ) : (
          <Button
            onClick={onBookClick}
            disabled={isLoading}
            className="w-full rounded-xl bg-blue-600 shadow-md shadow-blue-600/15 hover:bg-blue-700"
          >
            {isLoading ? (
              t("classes.booking")
            ) : (
              <>
                <span>{t("classes.book")}</span>
                <ArrowRight />
              </>
            )}
          </Button>
        )}
      </div>
    </Card>
  );
}
