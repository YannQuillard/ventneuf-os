import type { IconType } from "@astryxdesign/core/Icon";
import {
  ChartBarIcon,
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleLeftRightIcon,
  ChatBubbleOvalLeftIcon,
  ClockIcon,
  ComputerDesktopIcon,
  BookOpenIcon,
  HashtagIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import {
  ChartBarIcon as ChartBarSolidIcon,
  ChatBubbleLeftEllipsisIcon as ChatBubbleLeftEllipsisSolidIcon,
  ChatBubbleLeftRightIcon as ChatBubbleLeftRightSolidIcon,
  ChatBubbleOvalLeftIcon as ChatBubbleOvalLeftSolidIcon,
  ComputerDesktopIcon as ComputerDesktopSolidIcon,
  BookOpenIcon as BookOpenSolidIcon,
  HashtagIcon as HashtagSolidIcon,
  Squares2X2Icon as Squares2X2SolidIcon,
} from "@heroicons/react/24/solid";
import type { NavigationEntryKind } from "../../lib/workspace-navigation";
import type { SVGProps } from "react";

function MissionBranchIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M6 2v11a5 5 0 0 0 5 5h7" />
  </svg>;
}

export const navigationIcons: Record<NavigationEntryKind, { icon: IconType; selectedIcon: IconType }> = {
  main: { icon: ChatBubbleLeftRightIcon, selectedIcon: ChatBubbleLeftRightSolidIcon },
  conversation: { icon: ChatBubbleOvalLeftIcon, selectedIcon: ChatBubbleOvalLeftSolidIcon },
  temporary: { icon: ClockIcon, selectedIcon: ClockIcon },
  thread: { icon: ChatBubbleLeftEllipsisIcon, selectedIcon: ChatBubbleLeftEllipsisSolidIcon },
  mission: { icon: MissionBranchIcon, selectedIcon: MissionBranchIcon },
  project: { icon: Squares2X2Icon, selectedIcon: Squares2X2SolidIcon },
  memory: { icon: BookOpenIcon, selectedIcon: BookOpenSolidIcon },
  channel: { icon: HashtagIcon, selectedIcon: HashtagSolidIcon },
  devices: { icon: ComputerDesktopIcon, selectedIcon: ComputerDesktopSolidIcon },
  usage: { icon: ChartBarIcon, selectedIcon: ChartBarSolidIcon },
};
