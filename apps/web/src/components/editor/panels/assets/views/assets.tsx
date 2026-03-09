"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PanelView } from "@/components/editor/panels/assets/views/base-view";
import { MediaDragOverlay } from "@/components/editor/panels/assets/drag-overlay";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { useEditor } from "@/hooks/use-editor";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useRevealItem } from "@/hooks/use-reveal-item";
import { fetchMediaFileFromUrl, processMediaAssets } from "@/lib/media/processing";
import { buildElementFromMedia } from "@/lib/timeline/element-utils";
import {
	type MediaSortKey,
	type MediaSortOrder,
	type MediaViewMode,
	useAssetsPanelStore,
} from "@/stores/assets-panel-store";
import type { MediaAsset } from "@/types/assets";
import { cn } from "@/utils/ui";
import {
	CloudUploadIcon,
	GridViewIcon,
	LeftToRightListDashIcon,
	SortingOneNineIcon,
	Image02Icon,
	MusicNote03Icon,
	Video01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

const AUTO_IMPORT_QUERY_URL_KEYS = [
	"assetUrl",
	"asset_url",
	"cdnUrl",
	"cdn_url",
] as const;
const AUTO_IMPORT_QUERY_LIST_KEYS = [
	"assetUrls",
	"asset_urls",
	"cdnUrls",
	"cdn_urls",
] as const;
const AUTO_IMPORT_MESSAGE_TYPES = new Set([
	"opencut:import-asset-url",
	"opencut:import-asset-urls",
	"opencut:import-media-url",
	"opencut:import-media-urls",
]);

function dedupeUrls({ urls }: { urls: string[] }): string[] {
	const normalized = urls.map((url) => url.trim()).filter((url) => url.length > 0);
	return Array.from(new Set(normalized));
}

function getUrlsFromMessagePayload(payload: unknown): string[] {
	if (!payload || typeof payload !== "object") {
		return [];
	}

	const data = payload as Record<string, unknown>;
	const urls: string[] = [];

	if (typeof data.url === "string") {
		urls.push(data.url);
	}
	if (typeof data.assetUrl === "string") {
		urls.push(data.assetUrl);
	}
	if (Array.isArray(data.urls)) {
		for (const value of data.urls) {
			if (typeof value === "string") {
				urls.push(value);
			}
		}
	}
	if (Array.isArray(data.assetUrls)) {
		for (const value of data.assetUrls) {
			if (typeof value === "string") {
				urls.push(value);
			}
		}
	}

	const listFields = [data.urls, data.assetUrls];
	for (const field of listFields) {
		if (typeof field === "string") {
			urls.push(...field.split(","));
		}
	}

	return dedupeUrls({ urls });
}

export function MediaView() {
	const editor = useEditor();
	const mediaFiles = editor.media.getAssets();
	const activeProject = editor.project.getActive();
	const searchParams = useSearchParams();

	const {
		mediaViewMode,
		setMediaViewMode,
		highlightMediaId,
		clearHighlight,
		mediaSortBy,
		mediaSortOrder,
		setMediaSort,
	} = useAssetsPanelStore();
	const { highlightedId, registerElement } = useRevealItem(
		highlightMediaId,
		clearHighlight,
	);

	const [isProcessing, setIsProcessing] = useState(false);
	const [progress, setProgress] = useState(0);
	const [isImportUrlDialogOpen, setIsImportUrlDialogOpen] = useState(false);
	const [importUrlValue, setImportUrlValue] = useState("");
	const [isImportingUrl, setIsImportingUrl] = useState(false);
	const autoImportedUrlsRef = useRef<Set<string>>(new Set());
	const lastProjectIdRef = useRef<string | null>(null);
	const activeProjectId = activeProject?.metadata.id ?? null;

	useEffect(() => {
		if (lastProjectIdRef.current === activeProjectId) return;
		autoImportedUrlsRef.current.clear();
		lastProjectIdRef.current = activeProjectId;
	}, [activeProjectId]);

	const processFiles = useCallback(
		async ({
			files,
			getAssetOverrides,
		}: {
			files: FileList | File[];
			getAssetOverrides?: ({
				file,
			}: {
				file: File;
			}) => Partial<Omit<MediaAsset, "id">>;
		}): Promise<MediaAsset[]> => {
			if (!files || files.length === 0) return [];
			if (!activeProject) {
				toast.error("No active project");
				return [];
			}

			setIsProcessing(true);
			setProgress(0);
			const insertedAssets: MediaAsset[] = [];
			try {
				const processedAssets = await processMediaAssets({
					files,
					onProgress: (progress: { progress: number }) =>
						setProgress(progress.progress),
				});
				const knownAssetIds = new Set(
					editor.media.getAssets().map((asset) => asset.id),
				);

				for (const asset of processedAssets) {
					const assetOverrides = getAssetOverrides?.({ file: asset.file });
					await editor.media.addMediaAsset({
						projectId: activeProject.metadata.id,
						asset: {
							...asset,
							...assetOverrides,
						},
					});

					const createdAsset = editor
						.media
						.getAssets()
						.find((candidate) => !knownAssetIds.has(candidate.id));
					if (createdAsset) {
						knownAssetIds.add(createdAsset.id);
						insertedAssets.push(createdAsset);
					}
				}
				return insertedAssets;
			} catch (error) {
				console.error("Error processing files:", error);
				toast.error("Failed to process files");
				return [];
			} finally {
				setIsProcessing(false);
				setProgress(0);
			}
		},
		[activeProject, editor],
	);

	const addAssetsToTimeline = useCallback(
		({ assets, startTime = 0 }: { assets: MediaAsset[]; startTime?: number }) => {
			for (const asset of assets) {
				const duration =
					asset.duration ?? TIMELINE_CONSTANTS.DEFAULT_ELEMENT_DURATION;
				const element = buildElementFromMedia({
					mediaId: asset.id,
					mediaType: asset.type,
					name: asset.name,
					duration,
					startTime,
				});

				editor.timeline.insertElement({
					element,
					placement: { mode: "auto" },
				});
			}
		},
		[editor.timeline],
	);

	const { isDragOver, dragProps, openFilePicker, fileInputProps } =
		useFileUpload({
			accept: "image/*,video/*,audio/*",
			multiple: true,
			onFilesSelected: (files) => processFiles({ files }),
		});

	const importMediaUrl = useCallback(
		async ({
			url,
			showErrors = true,
			insertIntoTimeline = false,
		}: {
			url: string;
			showErrors?: boolean;
			insertIntoTimeline?: boolean;
		}): Promise<boolean> => {
			const normalizedUrl = url.trim();
			if (!normalizedUrl) {
				if (showErrors) {
					toast.error("Please enter a media URL");
				}
				return false;
			}

			if (!activeProject) {
				if (showErrors) {
					toast.error("No active project");
				}
				return false;
			}

			setIsImportingUrl(true);
			try {
				const file = await fetchMediaFileFromUrl({ url: normalizedUrl });
				const insertedAssets = await processFiles({
					files: [file],
					getAssetOverrides: () => ({ sourceUrl: normalizedUrl }),
				});
				if (insertIntoTimeline && insertedAssets.length > 0) {
					addAssetsToTimeline({ assets: insertedAssets, startTime: 0 });
				}
				return insertedAssets.length > 0;
			} catch (error) {
				console.error("Error importing media from URL:", error);
				if (showErrors) {
					const message =
						error instanceof Error ? error.message : "Failed to import media URL";
					toast.error(message);
				}
				return false;
			} finally {
				setIsImportingUrl(false);
			}
		},
		[activeProject, addAssetsToTimeline, processFiles],
	);

	const handleImportFromUrl = useCallback(async () => {
		const imported = await importMediaUrl({ url: importUrlValue });
		if (imported) {
			setIsImportUrlDialogOpen(false);
			setImportUrlValue("");
		}
	}, [importMediaUrl, importUrlValue]);

	const queryAutoImportUrls = useMemo(() => {
		const params = new URLSearchParams(searchParams.toString());
		const urls: string[] = [];

		for (const key of AUTO_IMPORT_QUERY_URL_KEYS) {
			urls.push(...params.getAll(key));
		}
		for (const key of AUTO_IMPORT_QUERY_LIST_KEYS) {
			for (const value of params.getAll(key)) {
				urls.push(...value.split(","));
			}
		}

		return dedupeUrls({ urls });
	}, [searchParams]);

	useEffect(() => {
		if (!activeProject || queryAutoImportUrls.length === 0) return;

		const pendingUrls = queryAutoImportUrls.filter(
			(url) => !autoImportedUrlsRef.current.has(url),
		);
		if (pendingUrls.length === 0) return;

		let isCancelled = false;
		const importPendingUrls = async () => {
			for (const url of pendingUrls) {
				if (isCancelled) return;

				autoImportedUrlsRef.current.add(url);
				const imported = await importMediaUrl({
					url,
					insertIntoTimeline: true,
				});
				if (!imported) {
					autoImportedUrlsRef.current.delete(url);
				}
			}
		};

		void importPendingUrls();

		return () => {
			isCancelled = true;
		};
	}, [activeProject, importMediaUrl, queryAutoImportUrls]);

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const payload = event.data;
			if (!payload || typeof payload !== "object") return;

			const data = payload as Record<string, unknown>;
			if (
				typeof data.type === "string" &&
				!AUTO_IMPORT_MESSAGE_TYPES.has(data.type)
			) {
				return;
			}

			const urls = getUrlsFromMessagePayload(payload);
			if (urls.length === 0) return;

			void (async () => {
				for (const url of urls) {
					if (autoImportedUrlsRef.current.has(url)) {
						continue;
					}

					autoImportedUrlsRef.current.add(url);
					const imported = await importMediaUrl({
						url,
						showErrors: false,
						insertIntoTimeline: true,
					});
					if (!imported) {
						autoImportedUrlsRef.current.delete(url);
					}
				}
			})();
		};

		window.addEventListener("message", handleMessage);
		return () => {
			window.removeEventListener("message", handleMessage);
		};
	}, [importMediaUrl]);

	const handleRemove = async ({
		event,
		id,
	}: {
		event: React.MouseEvent;
		id: string;
	}) => {
		event.stopPropagation();

		if (!activeProject) {
			toast.error("No active project");
			return;
		}

		await editor.media.removeMediaAsset({
			projectId: activeProject.metadata.id,
			id,
		});
	};

	const handleSort = ({ key }: { key: MediaSortKey }) => {
		if (mediaSortBy === key) {
			setMediaSort(key, mediaSortOrder === "asc" ? "desc" : "asc");
		} else {
			setMediaSort(key, "asc");
		}
	};

	const filteredMediaItems = useMemo(() => {
		const filtered = mediaFiles.filter((item) => !item.ephemeral);

		filtered.sort((a, b) => {
			let valueA: string | number;
			let valueB: string | number;

			switch (mediaSortBy) {
				case "name":
					valueA = a.name.toLowerCase();
					valueB = b.name.toLowerCase();
					break;
				case "type":
					valueA = a.type;
					valueB = b.type;
					break;
				case "duration":
					valueA = a.duration || 0;
					valueB = b.duration || 0;
					break;
				case "size":
					valueA = a.file.size;
					valueB = b.file.size;
					break;
				default:
					return 0;
			}

			if (valueA < valueB) return mediaSortOrder === "asc" ? -1 : 1;
			if (valueA > valueB) return mediaSortOrder === "asc" ? 1 : -1;
			return 0;
		});

		return filtered;
	}, [mediaFiles, mediaSortBy, mediaSortOrder]);

	return (
		<>
			<input {...fileInputProps} />

			<PanelView
				title="Assets"
				actions={
					<MediaActions
						mediaViewMode={mediaViewMode}
						setMediaViewMode={setMediaViewMode}
						isBusy={isProcessing || isImportingUrl}
						sortBy={mediaSortBy}
						sortOrder={mediaSortOrder}
						onSort={handleSort}
						onImportFromDevice={openFilePicker}
						onImportFromUrl={() => setIsImportUrlDialogOpen(true)}
					/>
				}
				className={cn(isDragOver && "bg-accent/30")}
				{...dragProps}
			>
				{isDragOver || filteredMediaItems.length === 0 ? (
					<MediaDragOverlay
						isVisible={true}
						isProcessing={isProcessing}
						progress={progress}
						onClick={openFilePicker}
					/>
				) : (
					<MediaItemList
						items={filteredMediaItems}
						mode={mediaViewMode}
						onRemove={handleRemove}
						highlightedId={highlightedId}
						registerElement={registerElement}
					/>
				)}
			</PanelView>
			<ImportFromUrlDialog
				isOpen={isImportUrlDialogOpen}
				url={importUrlValue}
				isSubmitting={isImportingUrl}
				onUrlChange={setImportUrlValue}
				onOpenChange={(open) => {
					setIsImportUrlDialogOpen(open);
					if (!open && !isImportingUrl) {
						setImportUrlValue("");
					}
				}}
				onSubmit={handleImportFromUrl}
			/>
		</>
	);
}

function MediaAssetDraggable({
	item,
	preview,
	isHighlighted,
	variant,
	isRounded,
}: {
	item: MediaAsset;
	preview: React.ReactNode;
	isHighlighted: boolean;
	variant: "card" | "compact";
	isRounded?: boolean;
}) {
	const editor = useEditor();

	const addElementAtTime = ({
		asset,
		startTime,
	}: {
		asset: MediaAsset;
		startTime: number;
	}) => {
		const duration =
			asset.duration ?? TIMELINE_CONSTANTS.DEFAULT_ELEMENT_DURATION;
		const element = buildElementFromMedia({
			mediaId: asset.id,
			mediaType: asset.type,
			name: asset.name,
			duration,
			startTime,
		});
		editor.timeline.insertElement({
			element,
			placement: { mode: "auto" },
		});
	};

	return (
		<DraggableItem
			name={item.name}
			preview={preview}
			dragData={{
				id: item.id,
				type: "media",
				mediaType: item.type,
				name: item.name,
				...(item.type !== "audio" && {
					targetElementTypes: ["video", "image"] as const,
				}),
			}}
			shouldShowPlusOnDrag={false}
			onAddToTimeline={({ currentTime }) =>
				addElementAtTime({ asset: item, startTime: currentTime })
			}
			variant={variant}
			isRounded={isRounded}
			isHighlighted={isHighlighted}
		/>
	);
}

function MediaItemWithContextMenu({
	item,
	children,
	onRemove,
}: {
	item: MediaAsset;
	children: React.ReactNode;
	onRemove: ({ event, id }: { event: React.MouseEvent; id: string }) => void;
}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger>{children}</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem>Export clips</ContextMenuItem>
				<ContextMenuItem
					variant="destructive"
					onClick={(event) => onRemove({ event, id: item.id })}
				>
					Delete
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function MediaItemList({
	items,
	mode,
	onRemove,
	highlightedId,
	registerElement,
}: {
	items: MediaAsset[];
	mode: MediaViewMode;
	onRemove: ({ event, id }: { event: React.MouseEvent; id: string }) => void;
	highlightedId: string | null;
	registerElement: (id: string, element: HTMLElement | null) => void;
}) {
	const isGrid = mode === "grid";

	return (
		<div
			className={cn(isGrid ? "grid gap-2" : "flex flex-col gap-1")}
			style={
				isGrid ? { gridTemplateColumns: "repeat(auto-fill, 160px)" } : undefined
			}
		>
			{items.map((item) => (
				<div key={item.id} ref={(element) => registerElement(item.id, element)}>
					<MediaItemWithContextMenu item={item} onRemove={onRemove}>
						<MediaAssetDraggable
							item={item}
							preview={
								<MediaPreview
									item={item}
									variant={isGrid ? "grid" : "compact"}
								/>
							}
							variant={isGrid ? "card" : "compact"}
							isRounded={isGrid ? false : undefined}
							isHighlighted={highlightedId === item.id}
						/>
					</MediaItemWithContextMenu>
				</div>
			))}
		</div>
	);
}

export function formatDuration({ duration }: { duration: number }) {
	const min = Math.floor(duration / 60);
	const sec = Math.floor(duration % 60);
	return `${min}:${sec.toString().padStart(2, "0")}`;
}

function MediaDurationBadge({ duration }: { duration?: number }) {
	if (!duration) return null;

	return (
		<div className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-xs text-white">
			{formatDuration({ duration })}
		</div>
	);
}

function MediaDurationLabel({ duration }: { duration?: number }) {
	if (!duration) return null;

	return (
		<span className="text-xs opacity-70">{formatDuration({ duration })}</span>
	);
}

function MediaTypePlaceholder({
	icon,
	label,
	duration,
	variant,
}: {
	icon: IconSvgElement;
	label: string;
	duration?: number;
	variant: "muted" | "bordered";
}) {
	const iconClassName = cn("size-6", variant === "bordered" && "mb-1");

	return (
		<div
			className={cn(
				"text-muted-foreground flex size-full flex-col items-center justify-center rounded",
				variant === "muted" ? "bg-muted/30" : "border",
			)}
		>
			<HugeiconsIcon icon={icon} className={iconClassName} />
			<span className="text-xs">{label}</span>
			<MediaDurationLabel duration={duration} />
		</div>
	);
}

function MediaPreview({
	item,
	variant = "grid",
}: {
	item: MediaAsset;
	variant?: "grid" | "compact";
}) {
	const shouldShowDurationBadge = variant === "grid";

	if (item.type === "image") {
		return (
			<div className="relative flex size-full items-center justify-center">
				<Image
					src={item.url ?? ""}
					alt={item.name}
					fill
					sizes="100vw"
					className="object-cover"
					loading="lazy"
					unoptimized
				/>
			</div>
		);
	}

	if (item.type === "video") {
		if (item.thumbnailUrl) {
			return (
				<div className="relative size-full">
					<Image
						src={item.thumbnailUrl}
						alt={item.name}
						fill
						sizes="100vw"
						className="rounded object-cover"
						loading="lazy"
						unoptimized
					/>
					{shouldShowDurationBadge ? (
						<MediaDurationBadge duration={item.duration} />
					) : null}
				</div>
			);
		}

		return (
			<MediaTypePlaceholder
				icon={Video01Icon}
				label="Video"
				duration={item.duration}
				variant="muted"
			/>
		);
	}

	if (item.type === "audio") {
		return (
			<MediaTypePlaceholder
				icon={MusicNote03Icon}
				label="Audio"
				duration={item.duration}
				variant="bordered"
			/>
		);
	}

	return (
		<MediaTypePlaceholder icon={Image02Icon} label="Unknown" variant="muted" />
	);
}

function MediaActions({
	mediaViewMode,
	setMediaViewMode,
	isBusy,
	sortBy,
	sortOrder,
	onSort,
	onImportFromDevice,
	onImportFromUrl,
}: {
	mediaViewMode: MediaViewMode;
	setMediaViewMode: (mode: MediaViewMode) => void;
	isBusy: boolean;
	sortBy: MediaSortKey;
	sortOrder: MediaSortOrder;
	onSort: ({ key }: { key: MediaSortKey }) => void;
	onImportFromDevice: () => void;
	onImportFromUrl: () => void;
}) {
	return (
		<div className="flex gap-1.5">
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							size="icon"
							variant="ghost"
							onClick={() =>
								setMediaViewMode(mediaViewMode === "grid" ? "list" : "grid")
							}
							disabled={isBusy}
							className="items-center justify-center"
						>
							{mediaViewMode === "grid" ? (
								<HugeiconsIcon icon={LeftToRightListDashIcon} />
							) : (
								<HugeiconsIcon icon={GridViewIcon} />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						<p>
							{mediaViewMode === "grid"
								? "Switch to list view"
								: "Switch to grid view"}
						</p>
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<DropdownMenu>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									size="icon"
									variant="ghost"
									disabled={isBusy}
									className="items-center justify-center"
								>
									<HugeiconsIcon icon={SortingOneNineIcon} />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<DropdownMenuContent align="end">
							<SortMenuItem
								label="Name"
								sortKey="name"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="Type"
								sortKey="type"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="Duration"
								sortKey="duration"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="File size"
								sortKey="size"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
						</DropdownMenuContent>
					</DropdownMenu>
					<TooltipContent>
						<p>
							Sort by {sortBy} (
							{sortOrder === "asc" ? "ascending" : "descending"})
						</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="outline"
						disabled={isBusy}
						size="sm"
						className="items-center justify-center gap-1.5"
					>
						<HugeiconsIcon icon={CloudUploadIcon} />
						Import
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={onImportFromDevice}>
						Import from device
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onImportFromUrl}>
						Import from URL
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function ImportFromUrlDialog({
	isOpen,
	onOpenChange,
	onSubmit,
	url,
	onUrlChange,
	isSubmitting,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: () => void;
	url: string;
	onUrlChange: (value: string) => void;
	isSubmitting: boolean;
}) {
	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (isSubmitting) return;
				onOpenChange(open);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Import media from URL</DialogTitle>
				</DialogHeader>
				<DialogBody className="gap-3">
					<Label htmlFor="media-url-input">Media URL</Label>
					<Input
						id="media-url-input"
						placeholder="https://example.com/video.mp4"
						value={url}
						disabled={isSubmitting}
						onChange={(event) => onUrlChange(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								onSubmit();
							}
						}}
					/>
					<p className="text-muted-foreground text-xs">
						Paste a direct image, video, or audio URL.
					</p>
				</DialogBody>
				<DialogFooter>
					<Button
						variant="outline"
						disabled={isSubmitting}
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						disabled={isSubmitting || url.trim().length === 0}
						onClick={onSubmit}
					>
						{isSubmitting ? "Importing..." : "Import"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function SortMenuItem({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	onSort,
}: {
	label: string;
	sortKey: MediaSortKey;
	currentSortBy: MediaSortKey;
	currentSortOrder: MediaSortOrder;
	onSort: ({ key }: { key: MediaSortKey }) => void;
}) {
	const isActive = currentSortBy === sortKey;
	const arrow = isActive ? (currentSortOrder === "asc" ? "↑" : "↓") : "";

	return (
		<DropdownMenuItem onClick={() => onSort({ key: sortKey })}>
			{label} {arrow}
		</DropdownMenuItem>
	);
}
