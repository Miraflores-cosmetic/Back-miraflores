'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ORDER_CHAT_ATTACHMENTS_MAX,
  ORDER_CHAT_UPLOAD_MAX_FILE_BYTES,
} from '@miraflores/order-chat-core';
import type { OrderChatPendingUiAttachment } from '@miraflores/order-chat-core';
import { isAllowedChatUploadFile, ORDER_CHAT_UNSUPPORTED_FILE_MESSAGE } from '../lib/chatUploadAccept';

export type ChatPendingAttachmentRef = {
  clientToken: string;
  filename: string;
  kind: 'IMAGE' | 'FILE';
  mimeType: string;
  fileUrl?: string;
  localPreviewUrl?: string;
  uploading: boolean;
};

type UploadedAttachment = {
  url: string;
  kind: 'IMAGE' | 'FILE';
  mimeType: string;
  filename: string;
};

type UseChatAttachmentsOpts = {
  enabled?: boolean;
  uploadFile: (file: File) => Promise<UploadedAttachment>;
  revokeFile?: (url: string) => Promise<void>;
  onError: (message: string | null) => void;
  maxFileBytes?: number;
  maxAttachments?: number;
  fileTooLargeMessage?: string;
  maxAttachmentsMessage?: string;
  uploadErrorFallback?: string;
};

function guessAttachmentKind(file: File): 'IMAGE' | 'FILE' {
  const mime = (file.type ?? '').toLowerCase();
  if (mime === 'application/pdf') return 'FILE';
  if (mime.startsWith('image/')) return 'IMAGE';
  const name = file.name.toLowerCase();
  if (/\.pdf$/.test(name)) return 'FILE';
  if (/\.(jpe?g|png|gif|webp)$/.test(name)) return 'IMAGE';
  return 'FILE';
}

export function useChatAttachments(opts: UseChatAttachmentsOpts) {
  const {
    enabled = true,
    uploadFile,
    revokeFile,
    onError,
    maxFileBytes = ORDER_CHAT_UPLOAD_MAX_FILE_BYTES,
    maxAttachments = ORDER_CHAT_ATTACHMENTS_MAX,
    fileTooLargeMessage = 'Файл слишком большой',
    maxAttachmentsMessage = `Не более ${ORDER_CHAT_ATTACHMENTS_MAX} вложений`,
    uploadErrorFallback = 'Не удалось загрузить файл',
  } = opts;

  const [pendingRefs, setPendingRefs] = useState<ChatPendingAttachmentRef[]>([]);

  const uploadBusy = useMemo(() => pendingRefs.some((r) => r.uploading), [pendingRefs]);

  const pendingOutgoingAttachments = useMemo((): OrderChatPendingUiAttachment[] => {
    return pendingRefs.map((r) => ({
      clientKey: r.clientToken,
      filename: r.filename,
      kind: r.kind,
      imageSrc: r.kind === 'IMAGE' ? r.fileUrl || r.localPreviewUrl || null : null,
      uploading: r.uploading,
    }));
  }, [pendingRefs]);

  const canSendAttachmentMessage = useMemo(
    () =>
      pendingRefs.some((r) => Boolean(r.fileUrl?.trim()) && !r.uploading) &&
      !pendingRefs.some((r) => r.uploading),
    [pendingRefs],
  );

  const pendingAttachmentsHint = useMemo(() => {
    if (!pendingRefs.length) return undefined;
    if (uploadBusy) return 'Загружаем файл...';
    return undefined;
  }, [pendingRefs.length, uploadBusy]);

  const getReadyAttachments = useCallback(() => {
    return pendingRefs.filter((r) => r.fileUrl && !r.uploading);
  }, [pendingRefs]);

  const clearPendingAttachments = useCallback(() => {
    setPendingRefs((prev) => {
      for (const row of prev) {
        if (row.localPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(row.localPreviewUrl);
        if (row.fileUrl && revokeFile) {
          void revokeFile(row.fileUrl).catch(() => undefined);
        }
      }
      return [];
    });
  }, [revokeFile]);

  const attachChatFiles = useCallback(
    async (files: File[]) => {
      if (!enabled || !files.length || uploadBusy) return;
      const room = maxAttachments - pendingRefs.length;
      if (room <= 0) {
        onError(maxAttachmentsMessage);
        return;
      }
      onError(null);
      for (const file of files.slice(0, room)) {
        if (!isAllowedChatUploadFile(file)) {
          onError(ORDER_CHAT_UNSUPPORTED_FILE_MESSAGE);
          continue;
        }
        if (file.size > maxFileBytes) {
          onError(fileTooLargeMessage);
          continue;
        }
        const clientToken = `${Date.now()}-${Math.random()}`;
        const kind = guessAttachmentKind(file);
        const localPreviewUrl = kind === 'IMAGE' ? URL.createObjectURL(file) : undefined;
        setPendingRefs((prev) => [
          ...prev,
          {
            clientToken,
            filename: file.name,
            kind,
            mimeType: file.type || 'application/octet-stream',
            localPreviewUrl,
            uploading: true,
          },
        ]);
        try {
          const uploaded = await uploadFile(file);
          setPendingRefs((prev) =>
            prev.map((r) =>
              r.clientToken === clientToken
                ? {
                    ...r,
                    uploading: false,
                    fileUrl: uploaded.url,
                    kind: uploaded.kind,
                    mimeType: uploaded.mimeType,
                    filename: uploaded.filename,
                  }
                : r,
            ),
          );
        } catch (e: unknown) {
          setPendingRefs((prev) => {
            const row = prev.find((r) => r.clientToken === clientToken);
            if (row?.localPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(row.localPreviewUrl);
            return prev.filter((r) => r.clientToken !== clientToken);
          });
          const msg = e instanceof Error ? e.message : uploadErrorFallback;
          onError(msg);
        }
      }
    },
    [
      enabled,
      fileTooLargeMessage,
      maxAttachments,
      maxAttachmentsMessage,
      maxFileBytes,
      onError,
      pendingRefs.length,
      uploadBusy,
      uploadErrorFallback,
      uploadFile,
    ],
  );

  const removePendingChatAttachment = useCallback(
    (clientKey: string) => {
      if (!enabled) return;
      setPendingRefs((prev) => {
        const row = prev.find((r) => r.clientToken === clientKey);
        if (row?.localPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(row.localPreviewUrl);
        if (row?.fileUrl && revokeFile) {
          void revokeFile(row.fileUrl).catch(() => undefined);
        }
        return prev.filter((r) => r.clientToken !== clientKey);
      });
    },
    [enabled, revokeFile],
  );

  return {
    pendingRefs,
    setPendingRefs,
    uploadBusy,
    pendingOutgoingAttachments,
    canSendAttachmentMessage,
    pendingAttachmentsHint,
    attachChatFiles,
    removePendingChatAttachment,
    getReadyAttachments,
    clearPendingAttachments,
  };
}
