"""
Windows compatibility shim for the gltest direct-mode loader.

gltest's `_inject_message_to_fd0()` writes the gl.message calldata to a temp
file, dup2's it onto fd 0 for the contract to read, then immediately
`os.unlink()`s the path inside a `finally` block. On POSIX that removes the
directory entry while the open fd keeps the data alive; on Windows a file that
still has an open handle (fd 0 references it) cannot be deleted, so the unlink
raises `OSError [WinError 32]` and every `direct_deploy()` fails.

By the time that unlink runs the injection has already completed (fd 0 is
pointing at the message, `vm._original_stdin_fd` is saved), so we call the
original and swallow only that one sharing-violation cleanup error. The
leftover temp file is left for the OS to reap -- harmless. This is a pure
test-harness shim; it does not touch the contract under test.
"""

import gltest.direct.loader as _loader

_orig_inject = _loader._inject_message_to_fd0


def _inject_message_to_fd0_winsafe(vm):
    try:
        return _orig_inject(vm)
    except OSError as e:
        # WinError 32 == ERROR_SHARING_VIOLATION (file in use). The message
        # was already injected onto fd 0 before the failing unlink; the only
        # casualty is a leaked temp file.
        if getattr(e, "winerror", None) == 32:
            return None
        raise


_loader._inject_message_to_fd0 = _inject_message_to_fd0_winsafe
