# ACP standalone/production differential

The integrated path fails during ACP initialization, before session creation or
prompt dispatch. Its copied production client reuses the 3-second read-only
Hermes source timeout for the official SDK `initialize` request. The adapter
converts that typed timeout into exit code 124.

The single authorized isolated diagnostic ran on port 4301. It recorded child
spawn and initialize dispatch, then the timeout-driven shutdown. It recorded no
initialize completion, session operation, prompt dispatch, notification,
assistant chunk, or final ACP result.

The minimum correction is to extract one shared official-SDK transport core and
give initialization the passing path's explicit 120-second deadline. The
conversation prompt deadline remains separate. No retry is needed.

See `result.json` for the complete field-by-field differential and bounded
monotonic trace.
