/**
 * `@fuber/ui`: tek tasarım sistemi (KURGU §12). Bütün arayüz buradaki bileşenlerden kurulur.
 * Bileşenler sunum içindir: IPC çağırmaz, `window.fuber`'a dokunmaz; veriyi ve olayları prop olarak alır.
 * Stil girişi: `@import "@fuber/ui/styles.css";` · Kullanım: packages/ui/README.md
 */

export { cn } from './cn';

// Hareket
export {
  durations,
  easings,
  spring,
  springs,
  fade,
  enter,
  stagger,
  STAGGER,
  reducePreset,
  useMotionPreset,
  useMotionTransition,
  useReducedMotion,
  type MotionPreset,
} from './motion';

export { springCurve, springPosition, SPRING_CSS, SPRING_CSS_BOUNCY } from './spring-css';

// Katmanlar
export {
  createLayerStack,
  layerStack,
  isStacked,
  type LayerKind,
  type LayerEntry,
  type LayerStack,
  type DismissReason,
} from './layers/stack';
export { LayerPortal, getLayerRoot, useLayer, useFocusTrap, getTabbables, type UseLayerOptions, type LayerPortalProps } from './layers/Layer';
export { computePosition, useAnchoredPosition, type Placement, type Side, type Align, type Position, type Rect } from './layers/anchor';

// Bileşenler
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './components/Button';
export { IconButton, type IconButtonProps, type IconButtonSize, type IconButtonVariant } from './components/IconButton';
export { Field, useField, type FieldProps } from './components/Field';
export { Input, controlFrame, type InputProps, type ControlSize } from './components/Input';
export { Textarea, type TextareaProps } from './components/Textarea';
export { Select, type SelectProps, type SelectOption } from './components/Select';
export { Switch, type SwitchProps } from './components/Switch';
export { Checkbox, type CheckboxProps, type CheckedState } from './components/Checkbox';
export { Tabs, TabPanel, type TabsProps, type TabItem, type TabPanelProps } from './components/Tabs';
export { Surface, Card, type SurfaceProps, type CardProps } from './components/Surface';
export { List, Row, type ListProps, type RowProps } from './components/List';
export { Badge, Chip, type BadgeProps, type ChipProps, type Tone } from './components/Badge';
export { Dialog, type DialogProps } from './components/Dialog';
export { Tooltip, type TooltipProps } from './components/Tooltip';
export { Menu, type MenuProps, type MenuItem, type MenuAction, type MenuSeparator, type MenuLabel } from './components/Menu';
export { EmptyState, type EmptyStateProps } from './components/EmptyState';
export { Skeleton, type SkeletonProps } from './components/Skeleton';
export { ProgressBar, ProgressRing, type ProgressBarProps, type ProgressRingProps } from './components/Progress';
export { DateStrip, toIsoDate, dayRange, type DateStripProps, type DateMarkTone } from './components/DateStrip';
export { KeyHint, type KeyHintProps } from './components/KeyHint';
export { Waveform, type WaveformProps } from './components/Waveform';
export { Spinner, type SpinnerProps } from './components/Spinner';

// Toast
export { Toaster, toast, toastStore, type ToasterProps } from './toast/Toaster';
export {
  createToastStore,
  type ToastOptions,
  type ToastRecord,
  type ToastStore,
  type ToastTone,
  type ToastAction,
} from './toast/store';

// Kabuk
export { AppShell, type AppShellProps } from './shell/AppShell';
export { NavRail, type NavRailProps, type NavItem } from './shell/NavRail';
export { PageHeader, type PageHeaderProps } from './shell/PageHeader';
export { Section, type SectionProps } from './shell/Section';
export {
  Workspace,
  WorkspaceHeader,
  WorkspaceGrid,
  Panel,
  Metric,
  AutoGrid,
  type WorkspaceProps,
  type WorkspaceHeaderProps,
  type WorkspaceGridProps,
  type PanelProps,
  type MetricProps,
} from './shell/Workspace';
export { StatusPill, type StatusPillProps, type StatusKind } from './shell/StatusPill';
export { Starfield, type StarfieldProps } from './shell/Starfield';
export { FuberLogo, FuberMark, type FuberLogoProps } from './shell/Brand';
export { Segmented, type SegmentedProps, type SegmentedOption } from './components/Segmented';

// Jarvis'in varlığı (Takımyıldız)
export { Presence, type PresenceProps } from './presence/Presence';
export { IslandShell, ISLAND_SHOULDER, type IslandShellProps, type IslandShellHandle } from './presence/IslandShell';
export { PRESENCE_STATES, PRESENCE_LABELS, isLiveState, type PresenceState } from './presence/types';
export { presenceStats } from './presence/ticker';
export { shapeLevel } from './presence/signal';

// Eski ad ("Öz"): `Presence`'ı çizer; dış arayüz korunur.
export { Core, CORE_STATES, CORE_LABELS, type CoreProps, type CoreState } from './core/Core';
