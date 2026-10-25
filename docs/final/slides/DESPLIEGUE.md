# Publicar la presentación en Vercel

Destino: **https://q-nino.vercel.app/slides**.

La ruta y el HTML ya están en `main`, incorporados en el commit [`bec4ddd`](https://github.com/GatitoFBI/IBM-QUAMTUM-HACKATON-PROTOTIPO/commit/bec4ddd9e228ae673b6adeade71ea0098f7a6233). Este PR añade el acceso **Presentación** en la cabecera del simulador y documenta la publicación. El proyecto de Vercel está administrado desde la cuenta de Fabricio.

## Publicación

1. Fusionar este PR en `main`.
2. En la cuenta que administra `q-nino.vercel.app`, abrir su proyecto de Vercel y publicar la revisión actual de `main` del repositorio `GatitoFBI/IBM-QUAMTUM-HACKATON-PROTOTIPO`. Si hay despliegue automático desde GitHub, comprobar que se haya creado un despliegue para el commit del merge. Si se utiliza el flujo manual, desplegar esa misma revisión.
3. Comprobar que el despliegue de producción esté listo y asociado a `q-nino.vercel.app`. Volver a desplegar una revisión antigua no incorpora los archivos nuevos.
4. Verificar la URL pública y los controles descritos abajo.

## Archivos que debe incluir el despliegue

| Archivo | Función |
|---|---|
| `slides/index.html` | Presentación completa, con seis diapositivas, notas y navegación |
| `vercel.json` | Reescribe `/slides` a `/slides/index.html` |
| `index.html` | Enlace **Presentación** en la cabecera del simulador |

La configuración actual sirve archivos estáticos desde la raíz (`outputDirectory: "."`). `docs/` está excluido mediante `.vercelignore`: el HTML publicado debe proceder de `slides/index.html`.

Si otro cambio introduce un directorio de salida como `dist`, su compilación debe copiar `slides/index.html` al mismo destino relativo dentro de ese directorio y conservar la regla de `/slides`.

## Comprobación en producción

- Abrir `/slides` sin iniciar sesión: debe cargar la presentación, no un error 404.
- Recorrer las seis diapositivas con las flechas o espacio.
- Abrir y cerrar las notas con `N`; activar pantalla completa con `F` cuando el navegador lo permita.
- Abrir el simulador desde la diapositiva 4 y comprobar que la página principal mantiene su funcionamiento.
- Confirmar que la diapositiva 5 conserva el aviso de resultados N ≥ 14 pendientes de integrar, hasta que el equipo entregue sus mediciones.

El HTML público debe coincidir con `docs/final/slides/Q_Nino_Pitch_Final_4min.html`. Para esta versión, su SHA-256 es:

```text
5d1844b593a2cce8b8b83b18f0b9661c6c476ae412ef3c23c138d809d24f297a
```

El push a GitHub y el merge del PR no certifican por sí solos la publicación en Vercel. La verificación termina al comprobar la URL pública.
