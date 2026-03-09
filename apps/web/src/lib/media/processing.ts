import { toast } from "sonner";
import type { MediaAsset } from "@/types/assets";
import { getMediaTypeFromFile } from "@/lib/media/media-utils";
import { getVideoInfo } from "./mediabunny";
import { Input, ALL_FORMATS, BlobSource, VideoSampleSink } from "mediabunny";

export interface ProcessedMediaAsset extends Omit<MediaAsset, "id"> {}

const THUMBNAIL_MAX_WIDTH = 1280;
const THUMBNAIL_MAX_HEIGHT = 720;
const SUPPORTED_MEDIA_TYPE_PREFIXES = ["image/", "video/", "audio/"] as const;
const MEDIA_EXTENSION_TO_MIME: Record<string, string> = {
	mp4: "video/mp4",
	m4v: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
	mkv: "video/x-matroska",
	mp3: "audio/mpeg",
	m4a: "audio/mp4",
	wav: "audio/wav",
	ogg: "audio/ogg",
	flac: "audio/flac",
	aac: "audio/aac",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	gif: "image/gif",
	svg: "image/svg+xml",
	avif: "image/avif",
};

const MEDIA_MIME_TO_EXTENSION: Record<string, string> = {
	"video/mp4": "mp4",
	"video/quicktime": "mov",
	"video/webm": "webm",
	"video/x-matroska": "mkv",
	"audio/mpeg": "mp3",
	"audio/mp4": "m4a",
	"audio/wav": "wav",
	"audio/ogg": "ogg",
	"audio/flac": "flac",
	"audio/aac": "aac",
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
	"image/svg+xml": "svg",
	"image/avif": "avif",
};

const getThumbnailSize = ({
	width,
	height,
}: {
	width: number;
	height: number;
}): { width: number; height: number } => {
	const aspectRatio = width / height;
	let targetWidth = width;
	let targetHeight = height;

	if (targetWidth > THUMBNAIL_MAX_WIDTH) {
		targetWidth = THUMBNAIL_MAX_WIDTH;
		targetHeight = Math.round(targetWidth / aspectRatio);
	}
	if (targetHeight > THUMBNAIL_MAX_HEIGHT) {
		targetHeight = THUMBNAIL_MAX_HEIGHT;
		targetWidth = Math.round(targetHeight * aspectRatio);
	}

	return { width: targetWidth, height: targetHeight };
};

const renderToThumbnailDataUrl = ({
	width,
	height,
	draw,
}: {
	width: number;
	height: number;
	draw: ({
		context,
		width,
		height,
	}: {
		context: CanvasRenderingContext2D;
		width: number;
		height: number;
	}) => void;
}): string => {
	const size = getThumbnailSize({ width, height });
	const canvas = document.createElement("canvas");
	canvas.width = size.width;
	canvas.height = size.height;
	const context = canvas.getContext("2d");

	if (!context) {
		throw new Error("Could not get canvas context");
	}

	draw({ context, width: size.width, height: size.height });
	return canvas.toDataURL("image/jpeg", 0.8);
};

export async function generateThumbnail({
	videoFile,
	timeInSeconds,
}: {
	videoFile: File;
	timeInSeconds: number;
}): Promise<string> {
	const input = new Input({
		source: new BlobSource(videoFile),
		formats: ALL_FORMATS,
	});

	const videoTrack = await input.getPrimaryVideoTrack();
	if (!videoTrack) {
		throw new Error("No video track found in the file");
	}

	const canDecode = await videoTrack.canDecode();
	if (!canDecode) {
		throw new Error("Video codec not supported for decoding");
	}

	const sink = new VideoSampleSink(videoTrack);

	const frame = await sink.getSample(timeInSeconds);

	if (!frame) {
		throw new Error("Could not get frame at specified time");
	}

	try {
		return renderToThumbnailDataUrl({
			width: videoTrack.displayWidth,
			height: videoTrack.displayHeight,
			draw: ({ context, width, height }) => {
				frame.draw(context, 0, 0, width, height);
			},
		});
	} finally {
		frame.close();
	}
}

export async function generateImageThumbnail({
	imageFile,
}: {
	imageFile: File;
}): Promise<string> {
	return new Promise((resolve, reject) => {
		const image = new window.Image();
		const objectUrl = URL.createObjectURL(imageFile);

		image.addEventListener("load", () => {
			try {
				const dataUrl = renderToThumbnailDataUrl({
					width: image.naturalWidth,
					height: image.naturalHeight,
					draw: ({ context, width, height }) => {
						context.drawImage(image, 0, 0, width, height);
					},
				});
				resolve(dataUrl);
			} catch (error) {
				reject(
					error instanceof Error ? error : new Error("Could not render image"),
				);
			} finally {
				URL.revokeObjectURL(objectUrl);
				image.remove();
			}
		});

		image.addEventListener("error", () => {
			URL.revokeObjectURL(objectUrl);
			image.remove();
			reject(new Error("Could not load image"));
		});

		image.src = objectUrl;
	});
}

function isSupportedMediaMimeType(mimeType: string): boolean {
	return SUPPORTED_MEDIA_TYPE_PREFIXES.some((prefix) =>
		mimeType.startsWith(prefix),
	);
}

function getExtensionFromPathname(pathname: string): string | null {
	const fileName = pathname.split("/").pop();
	if (!fileName || !fileName.includes(".")) return null;
	const extension = fileName.split(".").pop()?.toLowerCase();
	return extension || null;
}

function getFileNameFromContentDisposition(
	contentDisposition: string | null,
): string | null {
	if (!contentDisposition) return null;

	const utf8FileNameMatch = contentDisposition.match(
		/filename\*=UTF-8''([^;]+)/i,
	);
	if (utf8FileNameMatch?.[1]) {
		return decodeURIComponent(utf8FileNameMatch[1].trim().replace(/["']/g, ""));
	}

	const fileNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
	if (fileNameMatch?.[1]) {
		return decodeURIComponent(fileNameMatch[1].trim());
	}

	return null;
}

function getMediaMimeTypeFromUrl({
	url,
	contentType,
	fileNameFromHeaders,
}: {
	url: URL;
	contentType: string;
	fileNameFromHeaders: string | null;
}): string | null {
	if (contentType && isSupportedMediaMimeType(contentType)) {
		return contentType;
	}

	const headerFileExtension = fileNameFromHeaders
		? getExtensionFromPathname(fileNameFromHeaders)
		: null;
	if (headerFileExtension) {
		return MEDIA_EXTENSION_TO_MIME[headerFileExtension] ?? null;
	}

	const extension = getExtensionFromPathname(url.pathname);
	if (!extension) return null;
	return MEDIA_EXTENSION_TO_MIME[extension] ?? null;
}

function getMediaFileName({
	url,
	mimeType,
	fileNameFromHeaders,
}: {
	url: URL;
	mimeType: string;
	fileNameFromHeaders: string | null;
}): string {
	if (fileNameFromHeaders) {
		return fileNameFromHeaders;
	}

	const rawFileName = url.pathname.split("/").pop();
	const decodedFileName = rawFileName ? decodeURIComponent(rawFileName) : "";
	const hasExtension = decodedFileName.includes(".");

	if (decodedFileName && hasExtension) {
		return decodedFileName;
	}

	const extension =
		MEDIA_MIME_TO_EXTENSION[mimeType] ?? mimeType.split("/")[1] ?? "bin";

	if (!decodedFileName) {
		return `remote-media.${extension}`;
	}

	return `${decodedFileName}.${extension}`;
}

export async function fetchMediaFileFromUrl({
	url,
}: {
	url: string;
}): Promise<File> {
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url.trim());
	} catch {
		throw new Error("Please enter a valid URL");
	}

	const response = await fetch(parsedUrl.toString());
	if (!response.ok) {
		throw new Error(`Could not download file (${response.status})`);
	}

	const blob = await response.blob();
	if (blob.size === 0) {
		throw new Error("Downloaded file is empty");
	}

	const contentType = (
		response.headers.get("content-type") ??
		blob.type ??
		""
	)
		.split(";")[0]
		.trim()
		.toLowerCase();
	const fileNameFromHeaders = getFileNameFromContentDisposition(
		response.headers.get("content-disposition"),
	);
	const mimeType = getMediaMimeTypeFromUrl({
		url: parsedUrl,
		contentType,
		fileNameFromHeaders,
	});

	if (!mimeType) {
		throw new Error("URL must point to an image, video, or audio file");
	}

	const fileName = getMediaFileName({
		url: parsedUrl,
		mimeType,
		fileNameFromHeaders,
	});
	return new File([blob], fileName, {
		type: mimeType,
		lastModified: Date.now(),
	});
}

export async function processMediaAssets({
	files,
	onProgress,
}: {
	files: FileList | File[];
	onProgress?: ({ progress }: { progress: number }) => void;
}): Promise<ProcessedMediaAsset[]> {
	const fileArray = Array.from(files);
	const processedAssets: ProcessedMediaAsset[] = [];

	const total = fileArray.length;
	let completed = 0;

	for (const file of fileArray) {
		const fileType = getMediaTypeFromFile({ file });

		if (!fileType) {
			toast.error(`Unsupported file type: ${file.name}`);
			continue;
		}

		const url = URL.createObjectURL(file);
		let thumbnailUrl: string | undefined;
		let duration: number | undefined;
		let width: number | undefined;
		let height: number | undefined;
		let fps: number | undefined;

		try {
			if (fileType === "image") {
				const dimensions = await getImageDimensions({ file });
				width = dimensions.width;
				height = dimensions.height;
				thumbnailUrl = await generateImageThumbnail({ imageFile: file });
			} else if (fileType === "video") {
				try {
					const videoInfo = await getVideoInfo({ videoFile: file });
					duration = videoInfo.duration;
					width = videoInfo.width;
					height = videoInfo.height;
					fps = Number.isFinite(videoInfo.fps)
						? Math.round(videoInfo.fps)
						: undefined;

					thumbnailUrl = await generateThumbnail({
						videoFile: file,
						timeInSeconds: 1,
					});
				} catch (error) {
					console.warn("Video processing failed", error);
					try {
						const fallbackMetadata = await getVideoMetadataFromElement({
							file,
						});
						duration = fallbackMetadata.duration;
						width = fallbackMetadata.width;
						height = fallbackMetadata.height;
					} catch (fallbackError) {
						console.warn(
							"Video metadata fallback failed",
							fallbackError,
						);
					}
				}
			} else if (fileType === "audio") {
				// For audio, we don't set width/height/fps (they'll be undefined)
				duration = await getMediaDuration({ file });
			}

			processedAssets.push({
				name: file.name,
				type: fileType,
				file,
				url,
				thumbnailUrl,
				duration,
				width,
				height,
				fps,
			});

			await new Promise((resolve) => setTimeout(resolve, 0));

			completed += 1;
			if (onProgress) {
				const percent = Math.round((completed / total) * 100);
				onProgress({ progress: percent });
			}
		} catch (error) {
			console.error("Error processing file:", file.name, error);
			toast.error(`Failed to process ${file.name}`);
			URL.revokeObjectURL(url); // Clean up on error
		}
	}

	return processedAssets;
}

const getImageDimensions = ({
	file,
}: {
	file: File;
}): Promise<{ width: number; height: number }> => {
	return new Promise((resolve, reject) => {
		const img = new window.Image();
		const objectUrl = URL.createObjectURL(file);

		img.addEventListener("load", () => {
			const width = img.naturalWidth;
			const height = img.naturalHeight;
			resolve({ width, height });
			URL.revokeObjectURL(objectUrl);
			img.remove();
		});

		img.addEventListener("error", () => {
			reject(new Error("Could not load image"));
			URL.revokeObjectURL(objectUrl);
			img.remove();
		});

		img.src = objectUrl;
	});
};

const getMediaDuration = ({ file }: { file: File }): Promise<number> => {
	return new Promise((resolve, reject) => {
		const element = document.createElement(
			file.type.startsWith("video/") ? "video" : "audio",
		) as HTMLVideoElement;
		const objectUrl = URL.createObjectURL(file);

		element.addEventListener("loadedmetadata", () => {
			resolve(element.duration);
			URL.revokeObjectURL(objectUrl);
			element.remove();
		});

		element.addEventListener("error", () => {
			reject(new Error("Could not load media"));
			URL.revokeObjectURL(objectUrl);
			element.remove();
		});

		element.src = objectUrl;
		element.load();
	});
};

const getVideoMetadataFromElement = ({
	file,
}: {
	file: File;
}): Promise<{ duration: number; width: number; height: number }> => {
	return new Promise((resolve, reject) => {
		const video = document.createElement("video");
		const objectUrl = URL.createObjectURL(file);
		video.preload = "metadata";

		video.addEventListener("loadedmetadata", () => {
			resolve({
				duration: video.duration,
				width: video.videoWidth,
				height: video.videoHeight,
			});
			URL.revokeObjectURL(objectUrl);
			video.remove();
		});

		video.addEventListener("error", () => {
			reject(new Error("Could not load video metadata"));
			URL.revokeObjectURL(objectUrl);
			video.remove();
		});

		video.src = objectUrl;
		video.load();
	});
};
