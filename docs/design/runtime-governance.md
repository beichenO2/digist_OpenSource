# DiGist Runtime Governance

## Authority boundary

- PolarPort (`127.0.0.1:11050`) is the sole authority for the API port.
- PolarProcess (`127.0.0.1:11055`) is the sole authority for both persistent
  service lifecycles.
- Launchers run in the foreground and replace their shell with the Node
  process. They do not daemonize, write PID files, probe occupants, or send
  signals.

## Persistent services

| Service ID | Kind | Launcher | Port | Health | Auto-start |
|---|---|---|---:|---|---|
| `digist-api` | HTTP listener | `Start/api.sh` | 3800 | `/api/health` | true |
| `digist-engine-worker` | worker | `Start/engine.sh` | none | PID supervision | true |

The API launcher resolves the active `privportal-backend` dependency from
PolarPort and injects `POLARPRIVATE_URL`. The API process accepts only a port
injected by the governed launcher; it never kills an existing listener.

The engine has no network listener. Its former `data/.engine.pid` lock is
removed because PolarProcess owns singleton enforcement and lifecycle. The
legacy `digist-engine` record retains an immutable historical port in the
current PolarProcess registry, so it is retired as a stopped tombstone and the
canonical no-port worker uses `digist-engine-worker`.

## Legacy and task identities

- PolarProcess IDs `digist` and `digist-engine` are legacy identities.
  Migration stops only those exact records, disables auto-start, and leaves
  retired tombstones so neither can create a duplicate process.
- `digist-daily-digest`, `digist-auto-evolve`,
  `digist-to-knowlever-sync`, and `digist-summarize` are transient task
  identities. Migration neither executes them nor converts them to listeners.

## Registration and cutover

`scripts/register-runtime.sh prepare` retires the legacy records and creates
the canonical API and worker with `auto_start=false`, without a lifecycle
action. After each legacy service is stopped through its exact PolarProcess
endpoint, `scripts/register-runtime.sh finalize` enables canonical auto-start.
Runtime cutover remains separate from registration, with the other target PID
checked before and after each action.
