using System.ComponentModel.Composition;
using Microsoft.VisualStudio.Text.Classification;
using Microsoft.VisualStudio.Utilities;

namespace HSharp.VisualStudio.Editor
{
    internal static class HSharpContentType
    {
        public const string Name = "hsharp";
    }

    internal sealed class HSharpContentTypeDefinitions
    {
        [Export(typeof(ContentTypeDefinition))]
        [Name(HSharpContentType.Name)]
        [BaseDefinition("code")]
        public ContentTypeDefinition HSharpContentTypeDefinition = null;

        [Export(typeof(FileExtensionToContentTypeDefinition))]
        [FileExtension(".hs")]
        [ContentType(HSharpContentType.Name)]
        public FileExtensionToContentTypeDefinition HSharpFileExtensionDefinition = null;
    }

    [Export(typeof(IClassifierProvider))]
    [ContentType(HSharpContentType.Name)]
    internal sealed class HSharpClassifierProvider : IClassifierProvider
    {
        [Import]
        internal IClassificationTypeRegistryService Registry { get; set; }

        public IClassifier GetClassifier(Microsoft.VisualStudio.Text.ITextBuffer buffer)
        {
            return buffer.Properties.GetOrCreateSingletonProperty(
                () => new HSharpClassifier(Registry, buffer));
        }
    }
}
