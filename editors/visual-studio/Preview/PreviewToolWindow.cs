using Microsoft.VisualStudio.Shell;

namespace HSharp.VisualStudio.Preview
{
    public sealed class PreviewToolWindow : ToolWindowPane
    {
        public PreviewToolWindow() : base(null)
        {
            Caption = "h# Generated Code";
            Content = new PreviewControl();
        }
    }
}
