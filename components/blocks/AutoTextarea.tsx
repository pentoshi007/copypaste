"use client";

import { forwardRef, useCallback, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import { autoResize } from "@/lib/client/textarea";

type AutoTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> & { value: string };

const AutoTextarea = forwardRef<HTMLTextAreaElement, AutoTextareaProps>(function AutoTextarea(
  { value, className = "", ...props },
  forwarded,
) {
  const local = useRef<HTMLTextAreaElement | null>(null);

  const setRef = useCallback(
    (element: HTMLTextAreaElement | null) => {
      local.current = element;
      if (typeof forwarded === "function") forwarded(element);
      else if (forwarded) forwarded.current = element;
    },
    [forwarded],
  );

  useLayoutEffect(() => {
    if (local.current) autoResize(local.current);
  }, [value]);

  useLayoutEffect(() => {
    const element = local.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      autoResize(element);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <textarea
      ref={setRef}
      rows={1}
      value={value}
      spellCheck
      className={`block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-600 ${className}`}
      {...props}
    />
  );
});

export default AutoTextarea;
