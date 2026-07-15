import { useState } from "react";

export type TGalleryImage = { label: string; url: string };

/** Generic thumbnail grid + click-to-enlarge lightbox — reusable by any Studio extension that
 * declares an `image-gallery` render rule, not specific to any one plugin. */
export function ImageGallery({ images }: { images: TGalleryImage[] }): React.ReactElement {
  const [lightboxUrl, setLightboxUrl] = useState<string | undefined>();

  return (
    <>
      <div className="image-gallery-grid">
        {images.map((image) => (
          <button key={image.url} type="button" className="image-gallery-thumb" title={image.label} onClick={() => setLightboxUrl(image.url)}>
            <img src={image.url} alt={image.label} loading="lazy" />
          </button>
        ))}
      </div>
      {lightboxUrl ? (
        <div className="image-gallery-lightbox" onClick={() => setLightboxUrl(undefined)}>
          <img src={lightboxUrl} alt="" />
        </div>
      ) : null}
    </>
  );
}
