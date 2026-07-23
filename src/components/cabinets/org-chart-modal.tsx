"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CompactOrgChart } from "@/components/cabinets/compact-org-chart";
import type {
  CabinetAgentSummary,
  CabinetJobSummary,
  CabinetOverview,
} from "@/types/cabinets";

export function OrgChartModal({
  open,
  onOpenChange,
  cabinetName,
  agents,
  jobs,
  childCabinets,
  onAgentClick,
  onAgentSend,
  onChildCabinetClick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cabinetName: string;
  agents: CabinetAgentSummary[];
  jobs: CabinetJobSummary[];
  childCabinets: CabinetOverview["children"];
  onAgentClick: (agent: CabinetAgentSummary) => void;
  onAgentSend: (agent: CabinetAgentSummary) => void;
  onChildCabinetClick: (child: CabinetOverview["children"][number]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(92dvh,900px)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[96rem] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[96rem]">
        <DialogHeader className="sticky top-0 z-10 border-b border-border/70 bg-background px-4 py-4 pe-14 sm:px-6">
          <DialogTitle className="text-[14px] font-semibold tracking-tight">
            {cabinetName}: org chart
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-auto overscroll-contain px-3 py-5 sm:px-6 sm:py-8">
          <CompactOrgChart
            cabinetName={cabinetName}
            agents={agents}
            jobs={jobs}
            childCabinets={childCabinets}
            onAgentClick={onAgentClick}
            onAgentSend={onAgentSend}
            onChildCabinetClick={onChildCabinetClick}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
