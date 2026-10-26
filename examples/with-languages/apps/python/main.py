"""Executable entry point. Tests are authored in TypeScript, not in this application."""
import sys
from calculator.application import Application

if __name__ == "__main__":
    try:
        raise SystemExit(Application().run(sys.argv[1:]))
    except (ValueError, OverflowError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
