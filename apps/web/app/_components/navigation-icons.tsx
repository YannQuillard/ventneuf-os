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
  RocketLaunchIcon,
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
  RocketLaunchIcon as RocketLaunchSolidIcon,
  Squares2X2Icon as Squares2X2SolidIcon,
} from "@heroicons/react/24/solid";
import type { NavigationEntryKind } from "../../lib/workspace-navigation";

export const navigationIcons: Record<NavigationEntryKind, { icon: IconType; selectedIcon: IconType }> = {
  main: { icon: ChatBubbleLeftRightIcon, selectedIcon: ChatBubbleLeftRightSolidIcon },
  conversation: { icon: ChatBubbleOvalLeftIcon, selectedIcon: ChatBubbleOvalLeftSolidIcon },
  temporary: { icon: ClockIcon, selectedIcon: ClockIcon },
  thread: { icon: ChatBubbleLeftEllipsisIcon, selectedIcon: ChatBubbleLeftEllipsisSolidIcon },
  mission: { icon: RocketLaunchIcon, selectedIcon: RocketLaunchSolidIcon },
  project: { icon: Squares2X2Icon, selectedIcon: Squares2X2SolidIcon },
  memory: { icon: BookOpenIcon, selectedIcon: BookOpenSolidIcon },
  channel: { icon: HashtagIcon, selectedIcon: HashtagSolidIcon },
  devices: { icon: ComputerDesktopIcon, selectedIcon: ComputerDesktopSolidIcon },
  usage: { icon: ChartBarIcon, selectedIcon: ChartBarSolidIcon },
};
