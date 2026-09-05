import type { IconType } from "@astryxdesign/core/Icon";
import {
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleLeftRightIcon,
  ChatBubbleOvalLeftIcon,
  ClockIcon,
  HashtagIcon,
} from "@heroicons/react/24/outline";
import {
  ChatBubbleLeftEllipsisIcon as ChatBubbleLeftEllipsisSolidIcon,
  ChatBubbleLeftRightIcon as ChatBubbleLeftRightSolidIcon,
  ChatBubbleOvalLeftIcon as ChatBubbleOvalLeftSolidIcon,
  HashtagIcon as HashtagSolidIcon,
} from "@heroicons/react/24/solid";
import type { NavigationEntryKind } from "../../../lib/prototype/navigation";

export const navigationIcons: Record<NavigationEntryKind, { icon: IconType; selectedIcon: IconType }> = {
  main: { icon: ChatBubbleLeftRightIcon, selectedIcon: ChatBubbleLeftRightSolidIcon },
  conversation: { icon: ChatBubbleOvalLeftIcon, selectedIcon: ChatBubbleOvalLeftSolidIcon },
  temporary: { icon: ClockIcon, selectedIcon: ClockIcon },
  thread: { icon: ChatBubbleLeftEllipsisIcon, selectedIcon: ChatBubbleLeftEllipsisSolidIcon },
  channel: { icon: HashtagIcon, selectedIcon: HashtagSolidIcon },
};
