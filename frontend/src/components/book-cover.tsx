'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';

const placeholder = '/cover-placeholder.svg';

export function BookCover({ src, alt, sizes = '190px', priority = false }: {
  src: string;
  alt: string;
  sizes?: string;
  priority?: boolean;
  fill?: boolean;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  useEffect(() => setFailedSource(null), [src]);
  return <Image src={!src || failedSource === src ? placeholder : src} alt={alt}
    fill sizes={sizes} priority={priority} unoptimized onError={() => setFailedSource(src)} />;
}
