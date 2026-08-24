import type { OrderStatus } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { ORDER_STATUS_LABELS } from "@/lib/constants";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface TimelineEvent {
  id: string;
  status: OrderStatus;
  comment?: string | null;
  createdAt: Date | string;
  actor: { name: string; role: string };
}

export function OrderTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-slate-500">
          No status updates yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold text-slate-900">Order timeline</h2>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-6 border-l border-slate-200 pl-6">
          {events.map((event, index) => (
            <li key={event.id} className="relative">
              <span className="absolute -left-[1.85rem] top-1 flex h-3 w-3 rounded-full bg-indigo-600 ring-4 ring-white" />
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium text-slate-900">
                    {ORDER_STATUS_LABELS[event.status]}
                  </p>
                  <p className="text-sm text-slate-600">
                    {event.actor.name} · {event.actor.role}
                  </p>
                  {event.comment && (
                    <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      {event.comment}
                    </p>
                  )}
                </div>
                <time className="text-xs text-slate-500 whitespace-nowrap">
                  {formatDate(event.createdAt)}
                </time>
              </div>
              {index < events.length - 1 && (
                <div className="absolute -left-[1.35rem] top-4 h-full w-px bg-slate-200" />
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
