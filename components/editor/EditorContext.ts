"use client";

import { createContext, useContext, type KeyboardEvent, type PointerEvent } from "react";
import type { BlockStore } from "@/lib/client/blockStore";
import type { Caret } from "@/lib/client/textarea";
import type { BlockType } from "@/lib/editor/blockTypes";

export interface EditorApi {
  store: BlockStore;
  registerInput(key: string, element: HTMLTextAreaElement | HTMLInputElement | null): void;
  focusBlock(key: string, caret: Caret): void;
  stopEditing(key: string): void;
  focusNeighbor(key: string, direction: -1 | 1, caret: Caret): boolean;
  splitBlock(key: string, before: string, after: string): void;
  insertBelow(key: string): void;
  mergeBackward(key: string): void;
  mergeForward(key: string): void;
  indent(key: string, delta: 1 | -1): void;
  moveBy(key: string, direction: -1 | 1): void;
  duplicate(key: string): void;
  remove(key: string): void;
  convert(key: string, type: BlockType, options?: { checked?: boolean; content?: string }): void;
  slashOpen(key: string, anchor: HTMLElement, start: number): void;
  slashUpdate(key: string, value: string, caret: number): void;
  slashKeyDown(event: KeyboardEvent): boolean;
  openBlockMenu(key: string, anchor: HTMLElement): void;
  startDrag(event: PointerEvent, key: string): void;
  select(key: string, extend: boolean): void;
  escape(key: string): void;
  uploadFiles(files: File[], afterKey: string | null): void;
  pasteUrlIntoEmpty(key: string, url: string): boolean;
  committed(key: string): void;
}

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
  const api = useContext(EditorContext);
  if (!api) throw new Error("useEditor must be used inside an editor");
  return api;
}
