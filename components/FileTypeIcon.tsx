import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileVideo,
} from "lucide-react";
import { fileExtension } from "@/lib/format";

export function FileTypeIcon({
  fileName,
  mimeType,
  className = "w-5 h-5 text-slate-500 dark:text-slate-400",
}: {
  fileName: string;
  mimeType: string;
  className?: string;
}) {
  const ext = fileExtension(fileName);

  if (/^(zip|rar|7z|tar|gz|bz2|xz)$/.test(ext))
    return <FileArchive className={className} />;
  if (/^(pdf|doc|docx|odt|rtf|txt|md|epub)$/.test(ext))
    return <FileText className={className} />;
  if (/^(xls|xlsx|ods|csv|tsv)$/.test(ext))
    return <FileSpreadsheet className={className} />;
  if (/^(mp4|mkv|mov|avi|webm|m4v)$/.test(ext))
    return <FileVideo className={className} />;
  if (/^(mp3|wav|flac|aac|ogg|m4a)$/.test(ext))
    return <FileAudio className={className} />;
  if (
    /^(js|ts|tsx|jsx|py|java|c|cpp|go|rs|rb|php|json|yml|yaml|xml|html|css|sh)$/.test(
      ext,
    )
  )
    return <FileCode2 className={className} />;

  if (mimeType.startsWith("video/")) return <FileVideo className={className} />;
  if (mimeType.startsWith("audio/")) return <FileAudio className={className} />;
  if (mimeType.startsWith("text/")) return <FileText className={className} />;

  return <FileIcon className={className} />;
}
