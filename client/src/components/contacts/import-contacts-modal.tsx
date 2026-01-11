import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ImportContactsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PreviewResponse {
  headers: string[];
  previewRows: Record<string, string>[];
  suggestedMapping: {
    nameColumn: string | null;
    phoneColumn: string | null;
    emailColumn?: string | null;
    notesColumn?: string | null;
  };
  totalRows: number;
  aiDetection?: {
    used: boolean;
    confidence?: number;
    error?: string;
  } | null;
}

interface ImportResponse {
  success: boolean;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

export function ImportContactsModal({ open, onOpenChange }: ImportContactsModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "mapping" | "result">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [useAI, setUseAI] = useState(true);
  const [mapping, setMapping] = useState({
    nameColumn: "",
    phoneColumn: "",
    emailColumn: "",
    notesColumn: "",
    defaultTag: "",
  });
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);

  const previewMutation = useMutation({
    mutationFn: async ({ file, useAI }: { file: File; useAI: boolean }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("useAI", String(useAI));
      const res = await fetch("/api/contacts/import/preview", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to preview CSV");
      }
      return res.json() as Promise<PreviewResponse>;
    },
    onSuccess: (data) => {
      setPreview(data);
      setMapping({
        nameColumn: data.suggestedMapping.nameColumn || "",
        phoneColumn: data.suggestedMapping.phoneColumn || "",
        emailColumn: data.suggestedMapping.emailColumn || "",
        notesColumn: data.suggestedMapping.notesColumn || "",
        defaultTag: "",
      });
      setStep("mapping");
      
      if (data.aiDetection?.used) {
        toast({
          title: "AI detected columns",
          description: `Confidence: ${Math.round((data.aiDetection.confidence || 0) * 100)}%`,
        });
      } else if (data.aiDetection?.error) {
        toast({
          title: "AI detection failed",
          description: data.aiDetection.error,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to parse CSV",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("nameColumn", mapping.nameColumn);
      formData.append("phoneColumn", mapping.phoneColumn);
      formData.append("emailColumn", mapping.emailColumn);
      formData.append("notesColumn", mapping.notesColumn);
      formData.append("defaultPlatform", "whatsapp");
      if (mapping.defaultTag) {
        formData.append("defaultTag", mapping.defaultTag);
      }
      const res = await fetch("/api/contacts/import", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to import contacts");
      }
      return res.json() as Promise<ImportResponse>;
    },
    onSuccess: (data) => {
      setImportResult(data);
      setStep("result");
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/tags"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to import contacts",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.endsWith(".csv")) {
        toast({
          title: "Invalid file type",
          description: "Please select a CSV file",
          variant: "destructive",
        });
        return;
      }
      setFile(selectedFile);
      previewMutation.mutate({ file: selectedFile, useAI });
    }
  };

  const handleClose = () => {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setImportResult(null);
    setUseAI(true);
    setMapping({
      nameColumn: "",
      phoneColumn: "",
      emailColumn: "",
      notesColumn: "",
      defaultTag: "",
    });
    onOpenChange(false);
  };

  const handleImport = () => {
    if (!mapping.phoneColumn) {
      toast({
        title: "Phone column required",
        description: "Please select which column contains phone numbers",
        variant: "destructive",
      });
      return;
    }
    importMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Contacts from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file exported from your phonebook to import contacts
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">AI Column Detection</p>
                  <p className="text-xs text-muted-foreground">
                    Automatically identify name and phone columns
                  </p>
                </div>
              </div>
              <Switch
                checked={useAI}
                onCheckedChange={setUseAI}
                data-testid="switch-use-ai"
              />
            </div>

            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover-elevate transition-colors"
              onClick={() => fileInputRef.current?.click()}
              data-testid="dropzone-csv"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
                data-testid="input-csv-file"
              />
              {previewMutation.isPending ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-10 w-10 text-muted-foreground animate-spin" />
                  <p className="text-muted-foreground">
                    {useAI ? "AI is analyzing your CSV..." : "Parsing CSV..."}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-10 w-10 text-muted-foreground" />
                  <p className="font-medium">Click to upload CSV file</p>
                  <p className="text-sm text-muted-foreground">
                    Supports any column order - AI will find name & phone
                  </p>
                </div>
              )}
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <p>Phone numbers starting with 0 will be converted to +62 (Indonesia)</p>
              <p>Example: 081234567890 → +6281234567890</p>
            </div>
          </div>
        )}

        {step === "mapping" && preview && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">{file?.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {preview.totalRows} rows found
                  </p>
                </div>
              </div>
              {preview.aiDetection?.used && (
                <div className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                  <Sparkles className="h-3 w-3" />
                  <span>AI detected ({Math.round((preview.aiDetection.confidence || 0) * 100)}%)</span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h4 className="font-medium">Map Columns</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name Column</Label>
                  <Select
                    value={mapping.nameColumn}
                    onValueChange={(v) => setMapping({ ...mapping, nameColumn: v })}
                  >
                    <SelectTrigger data-testid="select-name-column">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">-- None --</SelectItem>
                      {preview.headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Phone Column *</Label>
                  <Select
                    value={mapping.phoneColumn}
                    onValueChange={(v) => setMapping({ ...mapping, phoneColumn: v })}
                  >
                    <SelectTrigger data-testid="select-phone-column">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {preview.headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Email Column</Label>
                  <Select
                    value={mapping.emailColumn}
                    onValueChange={(v) => setMapping({ ...mapping, emailColumn: v })}
                  >
                    <SelectTrigger data-testid="select-email-column">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">-- None --</SelectItem>
                      {preview.headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Notes Column</Label>
                  <Select
                    value={mapping.notesColumn}
                    onValueChange={(v) => setMapping({ ...mapping, notesColumn: v })}
                  >
                    <SelectTrigger data-testid="select-notes-column">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">-- None --</SelectItem>
                      {preview.headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Add Tag to Imported Contacts (optional)</Label>
                <Input
                  value={mapping.defaultTag}
                  onChange={(e) => setMapping({ ...mapping, defaultTag: e.target.value })}
                  placeholder="e.g., imported-2024"
                  data-testid="input-default-tag"
                />
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium">Preview</h4>
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      {preview.headers.slice(0, 5).map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.previewRows.slice(0, 3).map((row, i) => (
                      <tr key={i} className="border-t">
                        {preview.headers.slice(0, 5).map((h) => (
                          <td key={h} className="px-3 py-2 truncate max-w-[150px]">
                            {row[h] || "-"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose} data-testid="button-cancel-import">
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={importMutation.isPending}
                data-testid="button-start-import"
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  `Import ${preview.totalRows} Contacts`
                )}
              </Button>
            </div>
          </div>
        )}

        {step === "result" && importResult && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 p-6">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <h3 className="text-lg font-medium">Import Complete</h3>
            </div>

            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                <p className="text-2xl font-bold text-green-600">{importResult.created}</p>
                <p className="text-sm text-muted-foreground">Created</p>
              </div>
              <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                <p className="text-2xl font-bold text-blue-600">{importResult.updated}</p>
                <p className="text-sm text-muted-foreground">Updated</p>
              </div>
              <div className="p-4 bg-orange-50 dark:bg-orange-950 rounded-lg">
                <p className="text-2xl font-bold text-orange-600">{importResult.skipped}</p>
                <p className="text-sm text-muted-foreground">Skipped</p>
              </div>
            </div>

            {importResult.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-orange-600">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {importResult.errors.length} rows had issues
                  </span>
                </div>
                <div className="max-h-32 overflow-y-auto text-sm text-muted-foreground">
                  {importResult.errors.slice(0, 10).map((e, i) => (
                    <p key={i}>
                      Row {e.row}: {e.reason}
                    </p>
                  ))}
                  {importResult.errors.length > 10 && (
                    <p>... and {importResult.errors.length - 10} more</p>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={handleClose} data-testid="button-close-import">
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
