/**
 * Manufacturing icons — react-icons/hi2 (same as Project Management).
 * Drop-in replacements for lucide-react exports (supports `size` prop).
 */
import React from "react";
import {
  HiOutlineArrowDownTray,
  HiOutlineArrowLeft,
  HiOutlineArrowPath,
  HiOutlineArrowTrendingUp,
  HiOutlineArrowUpTray,
  HiOutlineArchiveBox,
  HiOutlineCalculator,
  HiOutlineBell,
  HiOutlineBolt,
  HiOutlineBars3BottomLeft,
  HiOutlineBookmarkSquare,
  HiOutlineBuildingOffice2,
  HiOutlineCalendarDays,
  HiOutlineChartBarSquare,
  HiOutlineCheck,
  HiOutlineCheckCircle,
  HiOutlineChevronRight,
  HiOutlineClipboardDocumentCheck,
  HiOutlineClipboardDocumentList,
  HiOutlineClock,
  HiOutlineCog6Tooth,
  HiOutlineCube,
  HiOutlineDocumentCheck,
  HiOutlineDocumentDuplicate,
  HiOutlineDocumentText,
  HiOutlineEllipsisHorizontal,
  HiOutlineExclamationCircle,
  HiOutlineExclamationTriangle,
  HiOutlineEye,
  HiOutlineEyeSlash,
  HiOutlineFunnel,
  HiOutlineBars3,
  HiOutlineMagnifyingGlass,
  HiOutlineMap,
  HiOutlinePause,
  HiOutlinePencil,
  HiOutlinePhoto,
  HiOutlinePlay,
  HiOutlinePlus,
  HiOutlinePrinter,
  HiOutlineSparkles,
  HiOutlineTrash,
  HiOutlineQueueList,
  HiOutlineSquares2X2,
  HiOutlineTruck,
  HiOutlineUserPlus,
  HiOutlineWrench,
  HiOutlineXMark,
} from "react-icons/hi2";

function wrap(Icon) {
  function MfgIcon({ size = 20, className = "", style, ...rest }) {
    return React.createElement(Icon, {
      className,
      size,
      style: { width: size, height: size, flexShrink: 0, ...style },
      "aria-hidden": true,
      ...rest,
    });
  }
  MfgIcon.displayName = Icon.displayName || "MfgIcon";
  return MfgIcon;
}

export const Activity = wrap(HiOutlineBolt);
export const AlertTriangle = wrap(HiOutlineExclamationTriangle);
export const ArrowLeft = wrap(HiOutlineArrowLeft);
export const Bell = wrap(HiOutlineBell);
export const CalendarDays = wrap(HiOutlineCalendarDays);
export const Check = wrap(HiOutlineCheck);
export const CheckCheck = wrap(HiOutlineCheckCircle);
export const CheckCircle2 = wrap(HiOutlineCheckCircle);
export const ChevronRight = wrap(HiOutlineChevronRight);
export const ClipboardCheck = wrap(HiOutlineClipboardDocumentCheck);
export const AlertCircle = wrap(HiOutlineExclamationCircle);
export const Archive = wrap(HiOutlineArchiveBox);
export const Boxes = wrap(HiOutlineArchiveBox);
export const Copy = wrap(HiOutlineDocumentDuplicate);
export const Download = wrap(HiOutlineArrowDownTray);
export const Eye = wrap(HiOutlineEye);
export const EyeOff = wrap(HiOutlineEyeSlash);
export const GitBranchPlus = wrap(HiOutlinePlus);
export const GripVertical = wrap(HiOutlineBars3BottomLeft);
export const Menu = wrap(HiOutlineBars3);
export const Percent = wrap(HiOutlineCalculator);
export const Printer = wrap(HiOutlinePrinter);
export const Sparkles = wrap(HiOutlineSparkles);
export const Trash2 = wrap(HiOutlineTrash);
export const ClipboardList = wrap(HiOutlineClipboardDocumentList);
export const Clock = wrap(HiOutlineClock);
export const Compass = wrap(HiOutlineMap);
export const Factory = wrap(HiOutlineBuildingOffice2);
export const FileCheck = wrap(HiOutlineDocumentCheck);
export const FileBarChart = wrap(HiOutlineChartBarSquare);
export const Filter = wrap(HiOutlineFunnel);
export const Image = wrap(HiOutlinePhoto);
export const LayoutDashboard = wrap(HiOutlineSquares2X2);
export const ListChecks = wrap(HiOutlineQueueList);
export const Loader2 = wrap(HiOutlineArrowPath);
export const Package = wrap(HiOutlineCube);
export const Pause = wrap(HiOutlinePause);
export const Pencil = wrap(HiOutlinePencil);
export const Play = wrap(HiOutlinePlay);
export const Plus = wrap(HiOutlinePlus);
export const Save = wrap(HiOutlineBookmarkSquare);
export const Search = wrap(HiOutlineMagnifyingGlass);
export const Settings = wrap(HiOutlineCog6Tooth);
export const TrendingUp = wrap(HiOutlineArrowTrendingUp);
export const Truck = wrap(HiOutlineTruck);
export const Upload = wrap(HiOutlineArrowUpTray);
export const UserPlus = wrap(HiOutlineUserPlus);
export const Wrench = wrap(HiOutlineWrench);
export const X = wrap(HiOutlineXMark);
export const FileText = wrap(HiOutlineDocumentText);
export const LogOut = wrap(HiOutlineArrowLeft);
export const User = wrap(HiOutlineEye);
