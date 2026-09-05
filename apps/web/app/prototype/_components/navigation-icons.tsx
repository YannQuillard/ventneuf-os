import type { IconType } from "@astryxdesign/core/Icon";
import {
  ChartBarIcon,
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleLeftRightIcon,
  ChatBubbleOvalLeftIcon,
  ClockIcon,
  ComputerDesktopIcon,
  HashtagIcon,
} from "@heroicons/react/24/outline";
import {
  ChartBarIcon as ChartBarSolidIcon,
  ChatBubbleLeftEllipsisIcon as ChatBubbleLeftEllipsisSolidIcon,
  ChatBubbleLeftRightIcon as ChatBubbleLeftRightSolidIcon,
  ChatBubbleOvalLeftIcon as ChatBubbleOvalLeftSolidIcon,
  ComputerDesktopIcon as ComputerDesktopSolidIcon,
  HashtagIcon as HashtagSolidIcon,
} from "@heroicons/react/24/solid";
import type { NavigationEntryKind } from "../../../lib/prototype/navigation";

export const navigationIcons: Record<NavigationEntryKind, { icon: IconType; selectedIcon: IconType }> = {
  main: { icon: ChatBubbleLeftRightIcon, selectedIcon: ChatBubbleLeftRightSolidIcon },
  conversation: { icon: ChatBubbleOvalLeftIcon, selectedIcon: ChatBubbleOvalLeftSolidIcon },
  temporary: { icon: ClockIcon, selectedIcon: ClockIcon },
  thread: { icon: ChatBubbleLeftEllipsisIcon, selectedIcon: ChatBubbleLeftEllipsisSolidIcon },
  channel: { icon: HashtagIcon, selectedIcon: HashtagSolidIcon },
  devices: { icon: ComputerDesktopIcon, selectedIcon: ComputerDesktopSolidIcon },
  usage: { icon: ChartBarIcon, selectedIcon: ChartBarSolidIcon },
};
