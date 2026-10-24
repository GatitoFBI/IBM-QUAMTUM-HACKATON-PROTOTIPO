"""Backend de Q-Niño: ejecuta Grover con Qiskit en vivo sobre los datos editados y sirve la web.

  python -m pip install -r requirements.txt
  python api.py      →  abrir http://127.0.0.1:8000

La web detecta /api/salud y pasa a usar Qiskit en vivo (indicador verde en la cabecera).
"""
from pathlib import Path

import qiskit
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from qiskit_grover import resolver_instancia

AQUI = Path(__file__).parent


class Datos(BaseModel):
    brigadas: list[str]
    zonas: list[str]
    F: list[list[int]]
    D: list[list[int]]
    semilla: int = Field(42, ge=0, le=99999)
    repeticiones: int = Field(10, ge=1, le=20)


app = FastAPI(title="Q-Niño · Grover con Qiskit")


@app.get("/api/salud")
def salud():
    return {"qiskit": qiskit.__version__}


@app.post("/api/grover")
def grover(d: Datos):
    n = len(d.F)
    if not 3 <= n <= 6:
        raise HTTPException(422, "N debe estar entre 3 y 6 (N = 6 ya simula 10 qubits)")
    for nombre, M in (("F", d.F), ("D", d.D)):
        if len(M) != n or any(len(fila) != n for fila in M):
            raise HTTPException(422, f"{nombre} debe ser una matriz {n}×{n}")
        if any(M[i][k] != M[k][i] for i in range(n) for k in range(n)) or any(M[i][i] for i in range(n)):
            raise HTTPException(422, f"{nombre} debe ser simétrica con diagonal 0")
        if any(not 0 <= v <= 999 for fila in M for v in fila):
            raise HTTPException(422, f"{nombre}: usa enteros entre 0 y 999")
    if len(d.brigadas) != n or len(d.zonas) != n:
        raise HTTPException(422, "Debe haber N brigadas y N zonas")
    # Con N = 6 cada ejecución tarda ~45 s: limitamos las repeticiones para que la demo responda
    reps = min(d.repeticiones, 3) if n == 6 else d.repeticiones
    return resolver_instancia(d.F, d.D, d.brigadas, d.zonas, d.semilla, reps)


app.mount("/", StaticFiles(directory=AQUI, html=True), name="web")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
