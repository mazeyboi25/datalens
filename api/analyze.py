from io import StringIO

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="DataLens Analysis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)

@app.get("/")
def health():
    return {"ok": True, "service": "DataLens Analysis API"}

@app.post("/")
async def analyze_csv(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")

    raw = await file.read()

    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV exceeds the 20 MB demo limit.")

    try:
        text = raw.decode("utf-8-sig")
        df = pd.read_csv(StringIO(text))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {exc}") from exc

    missing = int(df.isna().sum().sum())
    duplicates = int(df.duplicated().sum())

    columns = []

    for name in df.columns:
        series = df[name]

        info = {
            "name": str(name),
            "dtype": str(series.dtype),
            "valid": int(series.notna().sum()),
            "missing": int(series.isna().sum()),
            "unique": int(series.nunique(dropna=True)),
        }

        if pd.api.types.is_numeric_dtype(series):
            clean = series.dropna()

            if not clean.empty:
                info.update(
                    {
                        "min": float(clean.min()),
                        "max": float(clean.max()),
                        "mean": float(clean.mean()),
                        "median": float(clean.median()),
                        "std": float(clean.std(ddof=0)),
                    }
                )

        columns.append(info)

    return {
        "filename": file.filename,
        "rows": int(len(df)),
        "columns": int(len(df.columns)),
        "missing": missing,
        "duplicates": duplicates,
        "column_profiles": columns,
    }
