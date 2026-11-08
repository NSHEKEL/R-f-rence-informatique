import ctypes
import os
import sys
import threading


_owner = None
_kernel = None


def owner_alive():
    return _owner is None or _kernel.WaitForSingleObject(_owner, 0) == 258


def watch_parent(parent_pid=None):
    global _owner, _kernel
    if sys.platform != 'win32':
        return
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    kernel.WaitForSingleObject.restype = ctypes.c_uint32
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel.CloseHandle.restype = ctypes.c_int
    handle = kernel.OpenProcess(0x00100000, False, parent_pid or os.getppid())
    if not handle:
        raise OSError(ctypes.get_last_error(), 'Impossible de surveiller le parent EasyGest')
    _owner, _kernel = handle, kernel

    def wait():
        kernel.WaitForSingleObject(handle, 0xFFFFFFFF)
        os._exit(0)

    threading.Thread(target=wait, name='easygest-parent', daemon=True).start()


def health_state():
    return 'managed' if _owner is not None else 'standalone'
