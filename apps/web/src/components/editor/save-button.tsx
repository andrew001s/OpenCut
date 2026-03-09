"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/hooks/use-editor";
import type { MediaAsset } from "@/types/assets";
import { DEFAULT_EXPORT_OPTIONS } from "@/constants/export-constants";
import type { TimelineTrack } from "@/types/timeline";

const TOKINAI_SAVE_VIDEO_ENDPOINT =
	"https://tokinai-api-test.tokinai.com/api/assets/videos";
const RESOURCE_ID_IN_URL_REGEX = /\/video\/([^/?#]+)/i;
const UUID_IN_TEXT_REGEX =
	/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function extractResourceIdFromSourceUrl(sourceUrl: string): string | null {
	const match = sourceUrl.match(RESOURCE_ID_IN_URL_REGEX);
	return match?.[1] ?? null;
}

function extractResourceIdFromFileName(fileName: string): string | null {
	const match = fileName.match(UUID_IN_TEXT_REGEX);
	return match?.[0] ?? null;
}

function getCandidateVideoAsset({
	mediaAssets,
	tracks,
}: {
	mediaAssets: MediaAsset[];
	tracks: TimelineTrack[];
}) {
	const mediaById = new Map(mediaAssets.map((asset) => [asset.id, asset]));
	const timelineVideoElements = tracks
		.flatMap((track) =>
			track.elements.filter((element) => element.type === "video"),
		)
		.sort((a, b) => a.startTime - b.startTime);

	for (const element of timelineVideoElements) {
		const asset = mediaById.get(element.mediaId);
		if (!asset) continue;

		const resourceIdFromSource =
			typeof asset.sourceUrl === "string"
				? extractResourceIdFromSourceUrl(asset.sourceUrl)
				: null;
		const resourceIdFromFileName = extractResourceIdFromFileName(asset.name);
		const resourceId = resourceIdFromSource ?? resourceIdFromFileName;

		if (resourceId) {
			return {
				resourceId,
				resourceIdFromSource: Boolean(resourceIdFromSource),
			};
		}
	}

	for (const asset of mediaAssets) {
		if (asset.type !== "video") continue;

		const resourceIdFromSource =
			typeof asset.sourceUrl === "string"
				? extractResourceIdFromSourceUrl(asset.sourceUrl)
				: null;
		const resourceIdFromFileName = extractResourceIdFromFileName(asset.name);
		const resourceId = resourceIdFromSource ?? resourceIdFromFileName;

		if (resourceId) {
			return {
				resourceId,
				resourceIdFromSource: Boolean(resourceIdFromSource),
			};
		}
	}

	return null;
}

export function SaveVideoButton() {
	const editor = useEditor();
	const [isSaving, setIsSaving] = useState(false);
	const activeProject = editor.project.getActiveOrNull();
	const hasProject = !!activeProject;
	const mediaAssets = editor.media.getAssets();
	const tracks = editor.timeline.getTracks();

	const saveTarget = hasProject
		? getCandidateVideoAsset({ mediaAssets, tracks })
		: null;

	const handleSave = async () => {
		if (isSaving) return;
		if (!hasProject) {
			toast.error("No active project");
			return;
		}

		if (!saveTarget) {
			toast.error("No CDN video found to save");
			return;
		}

		setIsSaving(true);
		try {
			const { resourceId, resourceIdFromSource } = saveTarget;
			const activeProjectState = editor.project.getActiveOrNull();
			if (!activeProjectState) {
				toast.error("No active project");
				return;
			}

			if (!resourceIdFromSource) {
				toast.error("No CDN resource found to save");
				return;
			}

			const { isExporting } = editor.project.getExportState();
			if (isExporting) {
				toast.error("An export is already in progress");
				return;
			}

			const exportResult = await editor.project.export({
				options: {
					...DEFAULT_EXPORT_OPTIONS,
					format: "mp4",
					fps: activeProjectState.settings.fps,
				},
			});

			if (exportResult.cancelled) {
				toast.error("Save cancelled");
				return;
			}

			if (!exportResult.success || !exportResult.buffer) {
				throw new Error(exportResult.error || "Timeline export failed");
			}

			const uploadFile = new File([exportResult.buffer], `${resourceId}.mp4`, {
				type: "video/mp4",
				lastModified: Date.now(),
			});

			const formData = new FormData();
			formData.append("video", uploadFile, uploadFile.name);

			const response = await fetch(
				`${TOKINAI_SAVE_VIDEO_ENDPOINT}/${resourceId}`,
				{
					method: "PUT",
					body: formData,
				},
			);

			if (!response.ok) {
				const errorText = await response.text().catch(() => "");
				throw new Error(
					errorText ||
						`Save failed (${response.status} ${response.statusText})`,
				);
			}

			toast.success("Video saved successfully");
		} catch (error) {
			console.error("Failed to save video:", error);
			const message =
				error instanceof Error ? error.message : "Failed to save video";
			toast.error(message);
		} finally {
			editor.project.clearExportState();
			setIsSaving(false);
		}
	};

	return (
		<Button
			variant="outline"
			size="sm"
			onClick={handleSave}
			disabled={!hasProject || isSaving || !saveTarget}
			className="gap-1.5"
		>
			{isSaving ? "Guardando..." : "Guardar"}
		</Button>
	);
}
