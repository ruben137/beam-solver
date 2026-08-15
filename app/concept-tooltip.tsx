"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";

type Position = { left: number; top: number; width: number; arrowLeft: number; side: "above" | "below" };

export default function ConceptTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !contentRef.current) return;
    const update = () => {
      const trigger = triggerRef.current!.getBoundingClientRect();
      const content = contentRef.current!;
      const margin = 12;
      const gap = 9;
      const width = Math.min(260, window.innerWidth - margin * 2);
      content.style.width = `${width}px`;
      const height = content.getBoundingClientRect().height;
      const centeredLeft = trigger.left + trigger.width / 2 - width / 2;
      const left = Math.max(margin, Math.min(centeredLeft, window.innerWidth - width - margin));
      const side = trigger.top >= height + gap + margin ? "above" : "below";
      const top = side === "above" ? trigger.top - height - gap : trigger.bottom + gap;
      const arrowLeft = Math.max(10, Math.min(trigger.left + trigger.width / 2 - left, width - 10));
      setPosition({ left, top, width, arrowLeft, side });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open]);

  return <span className="concept-tooltip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button ref={triggerRef} type="button" className="concept-tooltip-trigger" aria-label={t("tooltip.info", { label })} aria-describedby={open ? id : undefined} aria-expanded={open} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
      <Info aria-hidden="true" size={14} strokeWidth={2} />
    </button>
    {open && createPortal(<span ref={contentRef} className={`concept-tooltip-content ${position?.side ?? "below"}`} id={id} role="tooltip" style={{ left: position?.left ?? 0, top: position?.top ?? 0, width: position?.width, visibility: position ? "visible" : "hidden", "--tooltip-arrow-left": `${position?.arrowLeft ?? 16}px` } as React.CSSProperties}>{children}</span>, document.body)}
  </span>;
}
