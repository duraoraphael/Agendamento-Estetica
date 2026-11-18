"use client";

import { useState } from "react";
import { Field } from "@/components/ui";
import { formatPlate } from "@/lib/plate";
import { LIMITS } from "@/lib/limits";

export interface VehicleDefaults {
  brand?: string;
  model?: string;
  plate?: string;
  year?: number | null;
  color?: string | null;
  nickname?: string | null;
}

/**
 * Campos do veículo (marca, modelo, placa, ano, cor e apelido). Uncontrolled: o servidor valida tudo de novo (Zod) e
 * devolve os erros por campo. `prefix` separa os nomes quando o formulário tem outros campos (etapa de agendamento).
 */
export function VehicleFields({ defaults = {}, errors = {}, prefix = "" }: { defaults?: VehicleDefaults; errors?: Record<string, string>; prefix?: string }) {
  const id = (name: string) => `${prefix}${name}`;
  // Campos CONTROLADOS: depois de uma ação de servidor o React 19 limpa os campos não controlados do formulário, e a cliente
  // perderia o que digitou quando houvesse um erro de validação.
  const [v, setV] = useState({
    brand: defaults.brand ?? "",
    model: defaults.model ?? "",
    plate: defaults.plate ? formatPlate(defaults.plate) : "",
    year: defaults.year ? String(defaults.year) : "",
    color: defaults.color ?? "",
    nickname: defaults.nickname ?? "",
  });
  const set = (key: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [key]: e.target.value }));
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={id("brand")} name={id("brand")} label="Marca" required maxLength={LIMITS.vehicleBrandMax} placeholder="Ex.: Fiat" value={v.brand} onChange={set("brand")} error={errors[id("brand")]} autoComplete="off" />
        <Field id={id("model")} name={id("model")} label="Modelo" required maxLength={LIMITS.vehicleModelMax} placeholder="Ex.: Argo" value={v.model} onChange={set("model")} error={errors[id("model")]} autoComplete="off" />
      </div>
      <Field
        id={id("plate")}
        name={id("plate")}
        label="Placa"
        required
        maxLength={8}
        placeholder="ABC1D23 ou ABC-1234"
        value={v.plate}
        onChange={set("plate")}
        error={errors[id("plate")]}
        hint="Aceitamos o formato antigo e o Mercosul."
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        style={{ textTransform: "uppercase" }}
      />
      <div className="grid gap-5 sm:grid-cols-3">
        <Field id={id("year")} name={id("year")} label="Ano (opcional)" type="number" inputMode="numeric" min={1900} max={new Date().getFullYear() + 1} value={v.year} onChange={set("year")} error={errors[id("year")]} />
        <Field id={id("color")} name={id("color")} label="Cor (opcional)" maxLength={LIMITS.vehicleColorMax} value={v.color} onChange={set("color")} error={errors[id("color")]} autoComplete="off" />
        <Field id={id("nickname")} name={id("nickname")} label="Apelido (opcional)" maxLength={LIMITS.vehicleNicknameMax} placeholder="Ex.: Meu daily" value={v.nickname} onChange={set("nickname")} error={errors[id("nickname")]} autoComplete="off" />
      </div>
    </div>
  );
}
