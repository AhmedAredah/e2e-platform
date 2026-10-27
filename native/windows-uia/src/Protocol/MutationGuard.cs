namespace E2E.Platform.Desktop.Protocol;

/// <summary>Only a failure before any platform mutation can authorize an action retry.</summary>
public sealed class MutationGuard
{
    private bool dispatched;

    public void Run(Action operation)
    {
        try { operation(); }
        catch when (dispatched) { throw new DriverException("ACTION_MAY_HAVE_COMMITTED"); }
    }

    public void Dispatch(Action operation)
    {
        dispatched = true;
        operation();
    }
}
