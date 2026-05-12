import type { ImageLoadingState, PageRenderData } from '@documenso/lib/client-only/providers/envelope-render-provider';
import { PDF_VIEWER_PAGE_CLASSNAME } from '@documenso/lib/constants/pdf-viewer';
import { cn } from '@documenso/ui/lib/utils';
import { useToast } from '@documenso/ui/primitives/use-toast';
import { Trans, useLingui } from '@lingui/react/macro';
import pMap from 'p-map';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ScrollTarget } from '../virtual-list/use-virtual-list';
import { useVirtualList } from '../virtual-list/use-virtual-list';
import { PdfViewerPageImage } from './pdf-viewer-page-image';
import { PdfViewerErrorState, PdfViewerLoadingState } from './pdf-viewer-states';
import { useScrollToPage } from './use-scroll-to-page';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type PageMeta = {
  width: number;
  height: number;
};

type LoadingState = 'loading' | 'loaded' | 'error';

const LOW_RENDER_RESOLUTION = 1;
const HIGH_RENDER_RESOLUTION = 2;

// D2DHQ fork: cap concurrent pdfjs metadata calls. Upstream uses pMap with
// the default concurrency=Infinity, which fires `getPage().getViewport()`
// for every page in parallel — for a 30-page contract that's 30 calls
// queued into the single pdfjs worker thread, briefly spiking memory and
// stalling the main thread on mobile while the worker drains them.
// hardwareConcurrency is 2-4 on phones and 8-16 on laptops; cap at 8.
const PDFJS_METADATA_CONCURRENCY =
  typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? Math.min(navigator.hardwareConcurrency, 8)
    : 4;
const IDLE_RENDER_DELAY = 200;

export type PDFViewerProps = {
  className?: string;

  /**
   * The PDF data to render.
   *
   * If it's a URL, it will be fetched and rendered.
   *
   * If null will render an empty state.
   */
  data: Uint8Array | string | null;

  /**
   * Ref to the scrollable parent container that handles scrolling.
   *
   * This must point to an element with `overflow-y: auto` or `overflow-y: scroll`
   * that is an ancestor of this component, or `'window'` to use the browser
   * window as the scroll container.
   */
  scrollParentRef: ScrollTarget;

  onDocumentLoad?: () => void;

  /**
   * Additional component to render next to the image, such as a Konva canvas
   * for rendering fields.
   */
  customPageRenderer?: React.FunctionComponent<{ pageData: PageRenderData }>;
} & React.HTMLAttributes<HTMLDivElement>;

export default function PDFViewer({
  className,
  data,
  scrollParentRef,
  onDocumentLoad,
  customPageRenderer,
  ...props
}: PDFViewerProps) {
  const { t } = useLingui();
  const { toast } = useToast();

  const $el = useRef<HTMLDivElement>(null);

  const [loadingState, setLoadingState] = useState<LoadingState>('loading');

  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  const [pages, setPages] = useState<PageMeta[]>([]);

  useEffect(() => {
    if (!data) {
      return;
    }

    let isCancelled = false;

    const fetchMetadata = async () => {
      try {
        setLoadingState('loading');
        setPages([]);

        if (isCancelled) {
          return;
        }

        let result: Uint8Array | null = typeof data === 'string' ? null : new Uint8Array(data);

        if (typeof data === 'string') {
          const response = await fetch(data);

          if (!response.ok) {
            throw new Error(`Failed to fetch PDF data: ${response.status}`);
          }

          result = new Uint8Array(await response.arrayBuffer());
        }

        if (isCancelled) {
          return;
        }

        const loadedPdf = await pdfjsLib.getDocument({ data: result!, cMapUrl: '/static/cmaps/' }).promise;

        if (isCancelled) {
          await loadedPdf.destroy();
          return;
        }

        // Destroy previous PDF if it exists
        if (pdfRef.current) {
          await pdfRef.current.destroy();
        }

        // eslint-disable-next-line require-atomic-updates
        pdfRef.current = loadedPdf;

        // Fetch the pages
        const pages = await pMap(
          Array.from({ length: loadedPdf.numPages }),
          async (_, pageIndex) => {
            const page = await loadedPdf.getPage(pageIndex + 1);
            const viewport = page.getViewport({ scale: 1 });

            return {
              width: viewport.width,
              height: viewport.height,
            };
          },
          { concurrency: PDFJS_METADATA_CONCURRENCY },
        );

        if (isCancelled) {
          return;
        }

        setPages(pages);

        setLoadingState('loaded');
      } catch (err) {
        if (isCancelled) {
          return;
        }

        console.error(err);
        setLoadingState('error');

        toast({
          title: t`Error`,
          description: t`An error occurred while loading the document.`,
          variant: 'destructive',
        });
      }
    };

    void fetchMetadata();

    return () => {
      isCancelled = true;

      if (pdfRef.current) {
        void pdfRef.current.destroy();
        pdfRef.current = null;
      }
    };
  }, [data]);

  // Notify when document is loaded
  useEffect(() => {
    if (loadingState === 'loaded' && onDocumentLoad) {
      onDocumentLoad();
    }
  }, [loadingState, onDocumentLoad]);

  const isLoading = loadingState === 'loading';
  const hasError = loadingState === 'error';

  if (!data) {
    return (
      <div ref={$el} className={cn('h-full w-full', className)} {...props}>
        <p className="py-32 text-center text-muted-foreground text-sm">
          <Trans>No document found</Trans>
        </p>
      </div>
    );
  }

  return (
    <div ref={$el} className={cn('h-full w-full', className)} {...props}>
      {/* Loading State */}
      {isLoading && <PdfViewerLoadingState />}

      {/* Error State */}
      {hasError && <PdfViewerErrorState />}

      {/* Loaded State */}
      {loadingState === 'loaded' && pages.length > 0 && pdfRef.current && (
        <VirtualizedPageList
          scrollParentRef={scrollParentRef}
          constraintRef={$el}
          numPages={pages.length}
          pages={pages}
          pdf={pdfRef.current}
          customPageRenderer={customPageRenderer}
        />
      )}
    </div>
  );
}

type VirtualizedPageListProps = {
  scrollParentRef: ScrollTarget;
  constraintRef: React.RefObject<HTMLDivElement>;
  pages: PageMeta[];
  numPages: number;
  pdf: pdfjsLib.PDFDocumentProxy;
  customPageRenderer?: React.FunctionComponent<{ pageData: PageRenderData }>;
};

const VirtualizedPageList = ({
  scrollParentRef,
  constraintRef,
  pages,
  numPages,
  pdf,
  customPageRenderer,
}: VirtualizedPageListProps) => {
  const contentRef = useRef<HTMLDivElement>(null);

  const { virtualItems, totalSize, constraintWidth, scrollToItem } = useVirtualList({
    scrollRef: scrollParentRef,
    constraintRef,
    contentRef,
    itemCount: numPages,
    itemSize: (index, width) => {
      const pageMeta = pages[index];

      // Calculate height based on aspect ratio and available width
      const aspectRatio = pageMeta.height / pageMeta.width;
      const scaledHeight = width * aspectRatio;

      // Add 32px for the page number text and margins (my-2 = 8px * 2 + text height ~16px)
      // Add additional 2px for the top and bottom borders.
      return scaledHeight + 32 + 2;
    },
    overscan: 5,
  });

  useScrollToPage(contentRef, scrollToItem);

  return (
    <div
      ref={contentRef}
      // Note: This is actually used.
      data-pdf-content=""
      data-page-count={numPages}
      style={{
        height: `${totalSize}px`,
        width: '100%',
        position: 'relative',
      }}
    >
      {virtualItems.map((virtualItem) => {
        const index = virtualItem.index;
        const pageMeta = pages[index];
        const pageNumber = index + 1;

        // Calculate scale based on constraint width
        const scale = constraintWidth / pageMeta.width;

        const scaledWidth = Math.floor(pageMeta.width * scale);
        const scaledHeight = Math.floor(pageMeta.height * scale);

        return (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: constraintWidth,
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <PdfViewerPage
              unscaledWidth={pageMeta.width}
              unscaledHeight={pageMeta.height}
              scaledWidth={scaledWidth}
              scaledHeight={scaledHeight}
              pageNumber={pageNumber}
              pdf={pdf}
              scale={scale}
              customPageRenderer={customPageRenderer}
            />

            <p className="my-2 text-center text-[11px] text-muted-foreground/80">
              <Trans>
                Page {pageNumber} of {numPages}
              </Trans>
            </p>
          </div>
        );
      })}
    </div>
  );
};

type PdfViewerPageProps = {
  pageNumber: number;
  pdf: pdfjsLib.PDFDocumentProxy;
  unscaledWidth: number;
  unscaledHeight: number;
  scaledWidth: number;
  scaledHeight: number;
  scale: number;
  customPageRenderer?: React.FunctionComponent<{ pageData: PageRenderData }>;
};

const PdfViewerPage = ({
  pageNumber,
  pdf,
  unscaledWidth,
  unscaledHeight,
  scaledWidth,
  scaledHeight,
  scale,
  customPageRenderer: CustomPageRenderer,
}: PdfViewerPageProps) => {
  // D2DHQ fork: track whether this page is actually in the viewport vs.
  // sitting in the virtual-list overscan slots. The HIGH-res render
  // upgrade only fires while `isVisible` is true, so overscan pages
  // stay at LOW res and the 7× scale-2 memory burst on phones is gone.
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      // SSR or unsupported runtime: assume visible so behavior matches upstream.
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(Boolean(entry?.isIntersecting));
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { imageProps, imageLoadingState } = usePdfPageImage({
    pageNumber,
    pdf,
    unscaledWidth,
    unscaledHeight,
    scaledWidth,
    scaledHeight,
    scale,
    isVisible,
  });

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded border border-border"
      style={{ width: scaledWidth, height: scaledHeight }}
    >
      {CustomPageRenderer && imageLoadingState === 'loaded' && (
        <CustomPageRenderer
          pageData={{
            scale,
            pageIndex: pageNumber - 1,
            pageNumber,
            pageWidth: unscaledWidth,
            pageHeight: unscaledHeight,
            imageLoadingState,
          }}
        />
      )}

      <PdfViewerPageImage imageLoadingState={imageLoadingState} imageProps={imageProps} />
    </div>
  );
};

/**
 * Manages rendering a page from a pdf.
 *
 * D2DHQ fork: `isVisible` (passed by `PdfViewerPage`) gates the HIGH-res
 * upgrade — overscan pages render at LOW res and only upgrade once they
 * scroll into view. Cuts mobile memory burst by ~7× during scroll without
 * affecting stationary signers (the visible page still upgrades to scale-2
 * after the usual idle delay).
 */
const usePdfPageImage = ({
  pageNumber,
  pdf,
  scale,
  scaledWidth,
  scaledHeight,
  isVisible,
}: PdfViewerPageProps & { isVisible: boolean }) => {
  const [imageLoadingState, setImageLoadingState] = useState<ImageLoadingState>('loading');

  const [imageUrl, setImageUrl] = useState('');
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const renderedResolutionRef = useRef<number | null>(null);
  const renderedPageNumberRef = useRef<number | null>(null);
  const renderedPdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const cancelRenderTask = () => {
      if (!renderTaskRef.current) {
        return;
      }

      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    };

    const hasMatchingRenderedImage = (resolution: number) => {
      return (
        renderedPdfRef.current === pdf &&
        renderedPageNumberRef.current === pageNumber &&
        renderedResolutionRef.current === resolution
      );
    };

    const setRenderedImageMeta = (resolution: number) => {
      renderedPdfRef.current = pdf;
      renderedPageNumberRef.current = pageNumber;
      renderedResolutionRef.current = resolution;
    };

    const renderAtResolution = async (resolution: number) => {
      let currentTask: pdfjsLib.RenderTask | null = null;

      try {
        if (isCancelled) {
          return;
        }

        if (hasMatchingRenderedImage(resolution)) {
          return;
        }

        cancelRenderTask();

        const page = await pdf.getPage(pageNumber);

        if (isCancelled) {
          return;
        }

        const renderScale = scale * resolution;
        const viewport = page.getViewport({ scale: renderScale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const context = canvas.getContext('2d');

        if (!context) {
          throw new Error('Failed to get canvas context');
        }

        currentTask = page.render({
          canvasContext: context,
          viewport,
          canvas,
        });
        renderTaskRef.current = currentTask;

        await currentTask.promise;

        if (isCancelled || renderTaskRef.current !== currentTask) {
          return;
        }

        setRenderedImageMeta(resolution);

        setImageUrl(canvas.toDataURL('image/jpeg'));
      } catch (err) {
        if (err instanceof Error && err.name === 'RenderingCancelledException') {
          return;
        }

        if (!isCancelled) {
          console.error(err);
          setImageLoadingState('error');
        }
      } finally {
        if (renderTaskRef.current === currentTask) {
          renderTaskRef.current = null;
        }
      }
    };

    void renderAtResolution(LOW_RENDER_RESOLUTION);

    // D2DHQ fork: only schedule the HIGH-res upgrade when the page is
    // actually in view. If the page is currently in an overscan slot,
    // skip the timer entirely; when it scrolls into view this effect
    // re-runs (isVisible flips to true) and the upgrade fires.
    if (isVisible) {
      idleTimerRef.current = setTimeout(() => {
        void renderAtResolution(HIGH_RENDER_RESOLUTION);
      }, IDLE_RENDER_DELAY);
    }

    return () => {
      isCancelled = true;

      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }

      cancelRenderTask();
    };
  }, [pdf, pageNumber, scale, isVisible]);

  const imageProps = useMemo(
    (): React.ImgHTMLAttributes<HTMLImageElement> & Record<string, unknown> & { alt: '' } => ({
      className: PDF_VIEWER_PAGE_CLASSNAME,
      width: Math.floor(scaledWidth),
      height: Math.floor(scaledHeight),
      alt: '',
      onLoad: () => setImageLoadingState('loaded'),
      onError: () => setImageLoadingState('error'),
      src: imageUrl,
      'data-page-number': pageNumber,
      draggable: false,
    }),
    [scaledWidth, scaledHeight, imageUrl, pageNumber],
  );

  return {
    imageProps,
    imageLoadingState,
  };
};
