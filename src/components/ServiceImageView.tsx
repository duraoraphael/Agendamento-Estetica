"use client";

import { useState } from "react";
import Image from "next/image";

export interface ViewPhoto {
  url: string;
  alt: string;
  width: number;
  height: number;
}

export interface FallbackPhoto {
  src: string;
  width: number;
  height: number;
  alt: string;
}

/**
 * Foto de um serviço com rede de segurança: sem foto cadastrada, ou se a foto falhar ao carregar (arquivo apagado,
 * Storage fora do ar, rede), mostra o placeholder da Garage Zero Zero no mesmo tamanho, sem quebrar o card.
 * `next/image` com largura e altura conhecidas (sem salto de layout), `sizes` responsivo e carregamento preguiçoso;
 * `priority` só quando a imagem está visível logo na primeira tela (quem chama decide).
 * `decorative`: o texto ao lado já descreve o serviço, então a imagem fica com alt vazio.
 */
export function ServiceImageView({
  photo,
  fallback,
  sizes,
  priority = false,
  decorative = false,
  className = "",
}: {
  photo: ViewPhoto | null | undefined;
  fallback: FallbackPhoto;
  sizes: string;
  priority?: boolean;
  decorative?: boolean;
  className?: string;
}) {
  // Guarda a URL que falhou (e não um booleano): se a foto mudar, volta a tentar a nova.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (photo && failedUrl !== photo.url) {
    return (
      <Image
        src={photo.url}
        alt={decorative ? "" : photo.alt}
        width={photo.width}
        height={photo.height}
        sizes={sizes}
        priority={priority}
        className={className}
        onError={() => setFailedUrl(photo.url)}
      />
    );
  }
  return (
    <Image
      src={fallback.src}
      alt={decorative ? "" : fallback.alt}
      width={fallback.width}
      height={fallback.height}
      sizes={sizes}
      priority={priority}
      className={className}
      data-placeholder="true"
    />
  );
}
