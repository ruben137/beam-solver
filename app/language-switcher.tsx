"use client";

import { useEffect } from "react";
import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./i18n-client";

export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const language = i18n.resolvedLanguage === "en" ? "en" : "es";
  useEffect(() => {
    const sync = (next: string) => { const locale = next === "en" ? "en" : "es"; document.documentElement.lang = locale; localStorage.setItem("beamlab-language", locale); };
    const saved = localStorage.getItem("beamlab-language");
    if (saved === "en" || saved === "es") void i18n.changeLanguage(saved); else sync(i18n.resolvedLanguage ?? "es");
    i18n.on("languageChanged", sync);
    return () => { i18n.off("languageChanged", sync); };
  }, [i18n]);
  return <div className="language-switch" aria-label={t("common.language")}><Languages size={15} aria-hidden="true" /><button className={language === "es" ? "active" : ""} onClick={() => void i18n.changeLanguage("es")} aria-pressed={language === "es"}>ES</button><button className={language === "en" ? "active" : ""} onClick={() => void i18n.changeLanguage("en")} aria-pressed={language === "en"}>EN</button></div>;
}
