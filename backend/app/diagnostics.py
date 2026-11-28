import logging
from contextvars import ContextVar
from functools import wraps

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from .paths import log_path

_step = ContextVar("easygest_diagnostic_step", default="api")


def mark_step(name):
    _step.set(name)


def diagnosed(name):
    def decorate(function):
        @wraps(function)
        def run(*args, **kwargs):
            token = _step.set(name)
            try:
                return function(*args, **kwargs)
            except HTTPException:
                raise
            except Exception as error:
                if not hasattr(error, "easygest_step"):
                    error.easygest_step = _step.get()
                raise
            finally:
                _step.reset(token)
        return run
    return decorate


def install_exception_handler(app):
    logger = logging.getLogger("easygest.api")
    target = log_path()
    if not any(getattr(handler, "baseFilename", None) == str(target.resolve()) for handler in logger.handlers):
        for handler in list(logger.handlers):
            logger.removeHandler(handler)
            handler.close()
        handler = logging.FileHandler(target, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
    logger.setLevel(logging.ERROR)
    logger.propagate = False

    @app.exception_handler(Exception)
    async def unhandled(request: Request, error: Exception):
        route = request.scope.get("route")
        step = getattr(error, "easygest_step", getattr(route, "name", "api"))
        if hasattr(error, "hide_parameters"):
            error.hide_parameters = True
        logger.error("%s %s step=%s", request.method, getattr(route, "path", "api"), step, exc_info=(type(error), error, error.__traceback__))
        return JSONResponse(status_code=500, content={"detail": f"Erreur interne : {type(error).__name__} — étape {step}"})
