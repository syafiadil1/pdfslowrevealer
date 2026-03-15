import { useEffect, useMemo, useRef, useState } from 'react';

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/svg+xml',
]);

const DEFAULT_SPEED = 0.12;
const SPEED_OPTIONS = [
  { label: 'Slow', value: 0.08 },
  { label: 'Normal', value: DEFAULT_SPEED },
  { label: 'Fast', value: 0.2 },
];

const initialDocumentState = {
  kind: null,
  fileName: '',
  src: '',
  pdfDoc: null,
  pageCount: 0,
};

let pdfLibraryPromise;

async function loadPdfLibrary() {
  if (!pdfLibraryPromise) {
    pdfLibraryPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }

  return pdfLibraryPromise;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function App() {
  const [documentState, setDocumentState] = useState(initialDocumentState);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageImage, setPageImage] = useState('');
  const [progress, setProgress] = useState(0.22);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [status, setStatus] = useState('Drop in a screenshot or PDF to start revealing.');
  const [error, setError] = useState('');
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);

  const animationFrameRef = useRef(0);
  const lastFrameRef = useRef(0);
  const objectUrlRef = useRef('');

  const stageSource = useMemo(() => {
    if (documentState.kind === 'image') {
      return documentState.src;
    }

    if (documentState.kind === 'pdf') {
      return pageImage;
    }

    return '';
  }, [documentState.kind, documentState.src, pageImage]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      lastFrameRef.current = 0;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return undefined;
    }

    const tick = (timestamp) => {
      if (!lastFrameRef.current) {
        lastFrameRef.current = timestamp;
      }

      const delta = (timestamp - lastFrameRef.current) / 1000;
      lastFrameRef.current = timestamp;

      setProgress((current) => {
        const next = clamp(current + delta * speed, 0, 1);
        if (next >= 1) {
          setIsPlaying(false);
        }
        return next;
      });

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, speed]);

  useEffect(() => {
    if (documentState.kind !== 'pdf' || !documentState.pdfDoc) {
      setPageImage('');
      return undefined;
    }

    let cancelled = false;

    async function renderCurrentPage() {
      try {
        setIsRenderingPdf(true);
        setError('');
        setStatus(`Rendering page ${pageNumber} of ${documentState.pageCount}...`);

        const page = await documentState.pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const targetWidth = 1400;
        const scale = targetWidth / viewport.width;
        const scaledViewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        await page.render({
          canvasContext: context,
          viewport: scaledViewport,
        }).promise;

        if (!cancelled) {
          setPageImage(canvas.toDataURL('image/png'));
          setStatus(`Showing page ${pageNumber} of ${documentState.pageCount}.`);
        }
      } catch (renderError) {
        if (!cancelled) {
          setError('Could not render that PDF page.');
          setStatus('Load a different file to continue.');
          setPageImage('');
        }
      } finally {
        if (!cancelled) {
          setIsRenderingPdf(false);
        }
      }
    }

    renderCurrentPage();

    return () => {
      cancelled = true;
    };
  }, [documentState.kind, documentState.pageCount, documentState.pdfDoc, pageNumber]);

  async function handleFileChange(event) {
    const [file] = event.target.files ?? [];
    if (!file) {
      return;
    }

    setError('');
    setIsPlaying(false);
    setProgress(0);

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = '';
    }

    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      await loadPdf(file);
      event.target.value = '';
      return;
    }

    if (IMAGE_TYPES.has(file.type) || file.type.startsWith('image/')) {
      loadImage(file);
      event.target.value = '';
      return;
    }

    setDocumentState(initialDocumentState);
    setStatus('Unsupported file type.');
    setError('Use a PDF or image file like JPG, PNG, WEBP, or GIF.');
    event.target.value = '';
  }

  function loadImage(file) {
    const nextUrl = URL.createObjectURL(file);
    objectUrlRef.current = nextUrl;
    setPageNumber(1);
    setPageImage('');
    setDocumentState({
      kind: 'image',
      fileName: file.name,
      src: nextUrl,
      pdfDoc: null,
      pageCount: 0,
    });
    setStatus(`Loaded image: ${file.name}`);
  }

  async function loadPdf(file) {
    try {
      setStatus(`Opening PDF: ${file.name}`);
      const data = await file.arrayBuffer();
      const pdfjs = await loadPdfLibrary();
      const pdfDoc = await pdfjs.getDocument({ data }).promise;
      setPageNumber(1);
      setPageImage('');
      setDocumentState({
        kind: 'pdf',
        fileName: file.name,
        src: '',
        pdfDoc,
        pageCount: pdfDoc.numPages,
      });
    } catch (loadError) {
      setDocumentState(initialDocumentState);
      setError('This PDF could not be opened.');
      setStatus('Try another PDF or switch to an image file.');
    }
  }

  function handleProgressChange(event) {
    setProgress(Number(event.target.value));
    setIsPlaying(false);
  }

  function togglePlayback() {
    if (!stageSource || isRenderingPdf) {
      return;
    }

    setIsPlaying((current) => !current);
  }

  function resetReveal() {
    setIsPlaying(false);
    setProgress(0);
  }

  function showPreviousPage() {
    setPageNumber((current) => clamp(current - 1, 1, documentState.pageCount));
    setIsPlaying(false);
  }

  function showNextPage() {
    setPageNumber((current) => clamp(current + 1, 1, documentState.pageCount));
    setIsPlaying(false);
  }

  return (
    <div className="app-shell">
      <div className="background-grid" />
      <main className="app">
        <section className="hero">
          <p className="eyebrow">Gradual Reveal</p>
          <h1>Made by Syafi.</h1>
          <p className="hero-copy">
            Everything stays in your browser. Use autoplay for a clean reveal or drag the slider to
            control exactly how much is visible.
          </p>
        </section>

        <section className="workspace">
          <div className="panel uploader-panel">
            <label className="upload-dropzone" htmlFor="asset-input">
              <input
                id="asset-input"
                type="file"
                accept="application/pdf,image/*"
                onChange={handleFileChange}
              />
              <span className="upload-kicker">Local File</span>
              <strong>Choose PDF or image</strong>
              <span>Supports JPG, JPEG, PNG, WEBP, GIF and PDF. One file at a time.</span>
            </label>

            <div className="status-card">
              <div>
                <span className="status-label">Status</span>
                <p>{status}</p>
              </div>
              {error ? <p className="error-text">{error}</p> : null}
              {documentState.fileName ? (
                <div className="file-meta">
                  <span>{documentState.fileName}</span>
                  <span>{documentState.kind === 'pdf' ? `${documentState.pageCount} pages` : 'Image asset'}</span>
                </div>
              ) : null}
            </div>

            <div className="control-group">
              <div className="control-header">
                <h2>Reveal Controls</h2>
                <span>{formatPercent(progress)}</span>
              </div>
              <input
                className="progress-slider"
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={progress}
                onChange={handleProgressChange}
                disabled={!stageSource}
              />

              <div className="button-row">
                <button type="button" onClick={togglePlayback} disabled={!stageSource || isRenderingPdf}>
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button type="button" onClick={resetReveal} disabled={!stageSource}>
                  Reset
                </button>
              </div>

              <label className="speed-control">
                <span>Autoplay Speed</span>
                <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                  {SPEED_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {documentState.kind === 'pdf' ? (
              <div className="control-group">
                <div className="control-header">
                  <h2>PDF Pages</h2>
                  <span>
                    {pageNumber} / {documentState.pageCount}
                  </span>
                </div>
                <div className="button-row">
                  <button type="button" onClick={showPreviousPage} disabled={pageNumber <= 1 || isRenderingPdf}>
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={showNextPage}
                    disabled={pageNumber >= documentState.pageCount || isRenderingPdf}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="panel stage-panel">
            <div className="stage-header">
              <div>
                <span className="status-label">Preview</span>
                <h2>{stageSource ? 'Live reveal stage' : 'No file loaded yet'}</h2>
              </div>
              <span className="stage-pill">{documentState.kind ? documentState.kind.toUpperCase() : 'READY'}</span>
            </div>

            <div className={`reveal-stage ${stageSource ? 'loaded' : ''}`}>
              {stageSource ? (
                <>
                  <img src={stageSource} alt="Reveal preview" className="stage-image" />
                  <div className="stage-curtain" style={{ transform: `scaleY(${1 - progress})` }} />
                  <div className="scan-line" style={{ top: `${progress * 100}%` }} />
                </>
              ) : (
                <div className="empty-state">
                  <strong>Start with a file</strong>
                  <span>Upload a results slip, scoreboard screenshot, or PDF page to preview the reveal.</span>
                </div>
              )}

              {isRenderingPdf ? <div className="loading-badge">Rendering PDF page...</div> : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
