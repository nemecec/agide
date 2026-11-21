import {
  AlarmClock,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleExclamationPoint,
  CircleX,
  Copy,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  Gauge,
  Globe,
  Hand,
  Inbox,
  Info,
  LayoutDashboard,
  ListPlus,
  ListTodo,
  Lock,
  LoaderCircle,
  MessageCircleQuestionMark,
  MessageSquareText,
  Minus,
  Monitor,
  Moon,
  OctagonX,
  PanelRight,
  Palette,
  Pencil,
  Plus,
  Radio,
  RotateCcwClock,
  RotateCw,
  Search,
  Settings,
  ShieldCheck,
  ShieldQuestionMark,
  Square,
  SquareTerminal,
  StickyNote,
  Sun,
  Trash,
  TriangleExclamationPoint,
  Undo2,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';

export type IconComponent = LucideIcon;

/** One meaning: the glyph and the words that name it for assistive technology and tooltips. */
export interface IconSpec {
  readonly icon: IconComponent;
  readonly label: string;
}

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const spec = (icon: IconComponent, label: string): IconSpec => ({ icon, label });

export const SURFACE_ICONS = {
  folder: spec(Folder, 'Folder'),
  'folder-open': spec(FolderOpen, 'Open folder'),
  session: spec(SquareTerminal, 'Claude session'),
  'browser-tab': spec(Globe, 'Browser tab'),
  agent: spec(Bot, 'Agent'),
  task: spec(ListTodo, 'Task'),
  note: spec(StickyNote, 'Note'),
} as const;
export type SurfaceKind = keyof typeof SURFACE_ICONS;

export const PANE_ICONS = {
  inbox: spec(Inbox, 'Inbox'),
  usage: spec(Gauge, 'Usage'),
  'agent-history': spec(RotateCcwClock, 'Agent history'),
  settings: spec(Settings, 'Settings'),
  layout: spec(LayoutDashboard, 'Layout'),
} as const;
export type PaneKind = keyof typeof PANE_ICONS;

export const STATUS_ICONS = {
  busy: spec(LoaderCircle, 'Busy'),
  waiting: spec(MessageCircleQuestionMark, 'Waiting'),
  failed: spec(CircleX, 'Failed'),
  done: spec(CircleCheck, 'Done'),
  idle: spec(CircleDashed, 'Idle'),
  exited: spec(Square, 'Exited'),
} as const;
export type StatusKind = keyof typeof STATUS_ICONS;

export const STATUS_TONES: Readonly<Record<StatusKind, Tone>> = {
  busy: 'info',
  waiting: 'warning',
  failed: 'danger',
  done: 'success',
  idle: 'neutral',
  exited: 'neutral',
};

/** The glyph of an inbox kind and the tone it is drawn in. The kind name always shows beside it. */
export const INBOX_KIND_ICONS = {
  approval: { ...spec(ShieldQuestionMark, 'Approval'), tone: 'warning' },
  reminder: { ...spec(AlarmClock, 'Reminder'), tone: 'info' },
  alert: { ...spec(TriangleExclamationPoint, 'Alert'), tone: 'warning' },
  failure: { ...spec(OctagonX, 'Failure'), tone: 'danger' },
  update: { ...spec(MessageSquareText, 'Update'), tone: 'neutral' },
  status: { ...spec(MessageSquareText, 'Status'), tone: 'neutral' },
} as const satisfies Record<string, IconSpec & { readonly tone: Tone }>;
export type InboxKind = keyof typeof INBOX_KIND_ICONS;

export const TONE_ICONS: Readonly<Record<Exclude<Tone, 'neutral'>, IconSpec>> = {
  info: spec(Info, 'Information'),
  success: spec(CircleCheck, 'Success'),
  warning: spec(TriangleExclamationPoint, 'Warning'),
  danger: spec(CircleExclamationPoint, 'Error'),
};

export const ACTION_ICONS = {
  add: spec(Plus, 'Add'),
  back: spec(ArrowLeft, 'Back'),
  forward: spec(ArrowRight, 'Forward'),
  reload: spec(RotateCw, 'Reload'),
  stop: spec(X, 'Stop'),
  'observe-on': spec(Eye, 'Observation on'),
  'observe-off': spec(EyeOff, 'Observation off'),
  live: spec(Radio, 'Live'),
  'needs-answer': spec(Hand, 'Needs answer'),
  'open-in-chrome': spec(ExternalLink, 'Open in Chrome'),
  more: spec(Ellipsis, 'More'),
  close: spec(X, 'Close'),
  remove: spec(Trash, 'Remove'),
  rename: spec(Pencil, 'Rename'),
  copy: spec(Copy, 'Copy'),
  search: spec(Search, 'Search'),
  undo: spec(Undo2, 'Undo'),
  trust: spec(ShieldCheck, 'Trust'),
  'permission-mode': spec(Lock, 'Permission mode'),
  'new-folder': spec(FolderPlus, 'New folder'),
  'new-task': spec(ListPlus, 'New task'),
  'open-to-side': spec(PanelRight, 'Open to the side'),
  devtools: spec(Wrench, 'Developer tools'),
  settings: spec(Settings, 'Settings'),
} as const;
export type ActionKind = keyof typeof ACTION_ICONS;

export const THEME_ICONS = {
  light: spec(Sun, 'Light'),
  dark: spec(Moon, 'Dark'),
  system: spec(Monitor, 'System'),
  picker: spec(Palette, 'Theme'),
} as const;
export type ThemeKind = keyof typeof THEME_ICONS;

/** Glyphs the components draw by themselves. */
export const CONTROL_ICONS = {
  disclosure: ChevronRight,
  menu: ChevronDown,
  check: Check,
  indeterminate: Minus,
  invalid: CircleX,
  loading: LoaderCircle,
} as const;
