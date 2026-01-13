import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Plus, Pencil, Trash2, Users, Building2, Loader2, Shield, ShieldCheck, User, Download, RefreshCw, CheckCircle2, AlertCircle, ImageIcon, Upload, X, MessageSquare, Link2, Unlink, Key, Copy, Eye, EyeOff } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import type { Department, UserRole } from "@shared/schema";

interface UserWithDepartments {
  id: string;
  username: string;
  role: UserRole;
  displayName: string | null;
  isActive: boolean;
  isDeletable: boolean;
  departments: Department[];
  createdAt: Date;
}

export default function AdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: users = [], isLoading: usersLoading } = useQuery<UserWithDepartments[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: departments = [], isLoading: deptsLoading } = useQuery<Department[]>({
    queryKey: ["/api/admin/departments"],
  });

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold">Admin Panel</h1>
        </div>
        <Button variant="outline" onClick={() => setLocation("/")}>
          Back to Inbox
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="users" className="space-y-6">
          <TabsList>
            <TabsTrigger value="users" data-testid="tab-users">
              <Users className="h-4 w-4 mr-2" />
              Users
            </TabsTrigger>
            <TabsTrigger value="departments" data-testid="tab-departments">
              <Building2 className="h-4 w-4 mr-2" />
              Departments
            </TabsTrigger>
            <TabsTrigger value="updates" data-testid="tab-updates">
              <Download className="h-4 w-4 mr-2" />
              Updates
            </TabsTrigger>
            <TabsTrigger value="branding" data-testid="tab-branding">
              <ImageIcon className="h-4 w-4 mr-2" />
              Branding
            </TabsTrigger>
            <TabsTrigger value="platforms" data-testid="tab-platforms">
              <MessageSquare className="h-4 w-4 mr-2" />
              Platforms
            </TabsTrigger>
            <TabsTrigger value="api-clients" data-testid="tab-api-clients">
              <Key className="h-4 w-4 mr-2" />
              API Clients
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4">
            <UsersTab
              users={users}
              departments={departments}
              isLoading={usersLoading}
              queryClient={queryClient}
              toast={toast}
            />
          </TabsContent>

          <TabsContent value="departments" className="space-y-4">
            <DepartmentsTab
              departments={departments}
              isLoading={deptsLoading}
              queryClient={queryClient}
              toast={toast}
            />
          </TabsContent>

          <TabsContent value="updates" className="space-y-4">
            <UpdatesTab toast={toast} />
          </TabsContent>

          <TabsContent value="branding" className="space-y-4">
            <BrandingTab toast={toast} />
          </TabsContent>

          <TabsContent value="platforms" className="space-y-4">
            <PlatformsTab toast={toast} />
          </TabsContent>

          <TabsContent value="api-clients" className="space-y-4">
            <ApiClientsTab toast={toast} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function UsersTab({
  users,
  departments,
  isLoading,
  queryClient,
  toast,
}: {
  users: UserWithDepartments[];
  departments: Department[];
  isLoading: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithDepartments | null>(null);

  const createUserMutation = useMutation({
    mutationFn: async (data: {
      username: string;
      password: string;
      role: UserRole;
      displayName: string;
      departmentIds: string[];
    }) => {
      const res = await apiRequest("POST", "/api/admin/users", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setShowCreateDialog(false);
      toast({ title: "User created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create user", variant: "destructive" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<{
      username: string;
      password: string;
      role: UserRole;
      displayName: string;
      isActive: boolean;
      departmentIds: string[];
    }>) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setEditingUser(null);
      toast({ title: "User updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update user", variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/users/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete user", variant: "destructive" });
    },
  });

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case "superadmin":
        return <ShieldCheck className="h-4 w-4" />;
      case "admin":
        return <Shield className="h-4 w-4" />;
      default:
        return <User className="h-4 w-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium">User Management</h2>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-user">
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <UserForm
              departments={departments}
              onSubmit={(data) => createUserMutation.mutate(data)}
              isLoading={createUserMutation.isPending}
              onCancel={() => setShowCreateDialog(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {users.map((user) => (
          <Card key={user.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    {getRoleIcon(user.role)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{user.displayName || user.username}</span>
                      <Badge variant={user.isActive ? "default" : "secondary"}>
                        {user.role}
                      </Badge>
                      {!user.isActive && (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground">@{user.username}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1 mr-4">
                    {user.role === "superadmin" ? (
                      <Badge variant="outline">All Departments</Badge>
                    ) : user.departments.length > 0 ? (
                      user.departments.slice(0, 3).map((dept) => (
                        <Badge key={dept.id} variant="outline">{dept.name}</Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">No departments</span>
                    )}
                    {user.departments.length > 3 && (
                      <Badge variant="outline">+{user.departments.length - 3}</Badge>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid={`button-edit-user-${user.id}`}
                    onClick={() => setEditingUser(user)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {user.isDeletable && (
                    <Button
                      size="icon"
                      variant="ghost"
                      data-testid={`button-delete-user-${user.id}`}
                      onClick={() => {
                        if (confirm("Are you sure you want to delete this user?")) {
                          deleteUserMutation.mutate(user.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent>
          {editingUser && (
            <UserForm
              user={editingUser}
              departments={departments}
              onSubmit={(data) => updateUserMutation.mutate({ id: editingUser.id, ...data })}
              isLoading={updateUserMutation.isPending}
              onCancel={() => setEditingUser(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserForm({
  user,
  departments,
  onSubmit,
  isLoading,
  onCancel,
}: {
  user?: UserWithDepartments;
  departments: Department[];
  onSubmit: (data: any) => void;
  isLoading: boolean;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState(user?.username || "");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [role, setRole] = useState<UserRole>(user?.role || "user");
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [selectedDepts, setSelectedDepts] = useState<string[]>(
    user?.departments.map((d) => d.id) || []
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: any = {
      username,
      displayName,
      role,
      isActive,
      departmentIds: selectedDepts,
    };
    if (password) {
      data.password = password;
    } else if (!user) {
      return;
    }
    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{user ? "Edit User" : "Create User"}</DialogTitle>
        <DialogDescription>
          {user ? "Update user details and permissions" : "Add a new user to the system"}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            data-testid="input-form-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            disabled={!!user}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">
            Password {user && "(leave blank to keep current)"}
          </Label>
          <Input
            id="password"
            data-testid="input-form-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!user}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="displayName">Display Name</Label>
          <Input
            id="displayName"
            data-testid="input-form-displayname"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as UserRole)} disabled={user?.role === "superadmin"}>
            <SelectTrigger data-testid="select-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="superadmin">Super Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {role !== "superadmin" && (
          <div className="space-y-2">
            <Label>Departments</Label>
            <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[60px]">
              {departments.map((dept) => (
                <Badge
                  key={dept.id}
                  variant={selectedDepts.includes(dept.id) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => {
                    setSelectedDepts((prev) =>
                      prev.includes(dept.id)
                        ? prev.filter((d) => d !== dept.id)
                        : [...prev, dept.id]
                    );
                  }}
                  data-testid={`badge-dept-${dept.id}`}
                >
                  {dept.name}
                </Badge>
              ))}
              {departments.length === 0 && (
                <span className="text-sm text-muted-foreground">No departments available</span>
              )}
            </div>
          </div>
        )}

        {user && (
          <div className="flex items-center justify-between">
            <Label htmlFor="isActive">Active</Label>
            <Switch
              id="isActive"
              checked={isActive}
              onCheckedChange={setIsActive}
              disabled={user.role === "superadmin"}
            />
          </div>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading} data-testid="button-save-user">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : user ? "Save Changes" : "Create User"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DepartmentsTab({
  departments,
  isLoading,
  queryClient,
  toast,
}: {
  departments: Department[];
  isLoading: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const createDeptMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      const res = await apiRequest("POST", "/api/admin/departments", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/departments"] });
      setShowCreateDialog(false);
      setName("");
      setDescription("");
      toast({ title: "Department created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create department", variant: "destructive" });
    },
  });

  const updateDeptMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name: string; description: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/departments/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/departments"] });
      setEditingDept(null);
      toast({ title: "Department updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update department", variant: "destructive" });
    },
  });

  const deleteDeptMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/departments/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/departments"] });
      toast({ title: "Department deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete department", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium">Department Management</h2>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-department">
              <Plus className="h-4 w-4 mr-2" />
              Add Department
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Department</DialogTitle>
              <DialogDescription>Add a new department to organize conversations</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="dept-name">Name</Label>
                <Input
                  id="dept-name"
                  data-testid="input-dept-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dept-desc">Description</Label>
                <Input
                  id="dept-desc"
                  data-testid="input-dept-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
              <Button
                onClick={() => createDeptMutation.mutate({ name, description })}
                disabled={!name || createDeptMutation.isPending}
                data-testid="button-save-department"
              >
                {createDeptMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {departments.map((dept) => (
          <Card key={dept.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="font-medium">{dept.name}</span>
                    {dept.description && (
                      <p className="text-sm text-muted-foreground">{dept.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid={`button-edit-dept-${dept.id}`}
                    onClick={() => {
                      setEditingDept(dept);
                      setName(dept.name);
                      setDescription(dept.description || "");
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid={`button-delete-dept-${dept.id}`}
                    onClick={() => {
                      if (confirm("Are you sure you want to delete this department?")) {
                        deleteDeptMutation.mutate(dept.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!editingDept} onOpenChange={(open) => !open && setEditingDept(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Department</DialogTitle>
            <DialogDescription>Update department details</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-dept-name">Name</Label>
              <Input
                id="edit-dept-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-dept-desc">Description</Label>
              <Input
                id="edit-dept-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingDept(null)}>Cancel</Button>
            <Button
              onClick={() => editingDept && updateDeptMutation.mutate({ id: editingDept.id, name, description })}
              disabled={!name || updateDeptMutation.isPending}
            >
              {updateDeptMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface UpdateStatus {
  isChecking: boolean;
  isUpdating: boolean;
  hasUpdate: boolean;
  localCommit: string | null;
  remoteCommit: string | null;
  lastChecked: string | null;
  updateLog: string[];
  error: string | null;
}

function UpdatesTab({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const { data: status, isLoading, refetch } = useQuery<UpdateStatus>({
    queryKey: ["/api/admin/update/status"],
    refetchInterval: (query) => {
      const data = query.state.data as UpdateStatus | undefined;
      return data?.isUpdating || data?.isChecking ? 2000 : false;
    },
  });

  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/update/check");
      return res.json();
    },
    onSuccess: () => {
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to check for updates", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/update/run");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Update started! The application will restart automatically." });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to start update", variant: "destructive" });
    },
  });

  const isProcessing = status?.isChecking || status?.isUpdating || checkMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            System Updates
          </CardTitle>
          <CardDescription>
            Check for and install updates from GitHub
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Button
              onClick={() => checkMutation.mutate()}
              disabled={isProcessing}
              data-testid="button-check-updates"
            >
              {status?.isChecking || checkMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Check for Updates
            </Button>

            {status?.hasUpdate && (
              <Button
                onClick={() => {
                  if (confirm("This will pull the latest code and restart the application. Continue?")) {
                    updateMutation.mutate();
                  }
                }}
                disabled={isProcessing}
                variant="default"
                data-testid="button-run-update"
              >
                {status?.isUpdating || updateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Install Update
              </Button>
            )}
          </div>

          {status?.lastChecked && (
            <p className="text-sm text-muted-foreground">
              Last checked: {new Date(status.lastChecked).toLocaleString()}
            </p>
          )}

          <div className="flex items-center gap-2">
            {status?.hasUpdate ? (
              <Badge className="bg-primary/10 text-primary">
                <AlertCircle className="h-3 w-3 mr-1" />
                Update Available
              </Badge>
            ) : status?.lastChecked ? (
              <Badge variant="outline" className="text-green-600 border-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Up to Date
              </Badge>
            ) : null}
          </div>

          {status?.localCommit && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Current: {status.localCommit.substring(0, 7)}</p>
              {status.remoteCommit && status.hasUpdate && (
                <p>Latest: {status.remoteCommit.substring(0, 7)}</p>
              )}
            </div>
          )}

          {status?.error && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              {status.error}
            </div>
          )}
        </CardContent>
      </Card>

      {status?.updateLog && status.updateLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Update Log</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-48 w-full rounded border bg-muted/50 p-3">
              <div className="space-y-1 font-mono text-xs">
                {status.updateLog.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap">{line}</div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface BrandingData {
  logoUrl: string | null;
  organizationName: string | null;
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (error) => reject(error));
    image.src = url;
  });
}

async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  
  if (!ctx) {
    throw new Error("Could not get canvas context");
  }

  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Canvas to Blob conversion failed"));
      }
    }, "image/png");
  });
}

function BrandingTab({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const { data: branding, isLoading, refetch } = useQuery<BrandingData>({
    queryKey: ["/api/admin/branding"],
  });

  const [organizationName, setOrganizationName] = useState("");
  const [hasInitialized, setHasInitialized] = useState(false);
  const [showCropDialog, setShowCropDialog] = useState(false);

  useEffect(() => {
    if (branding && !hasInitialized) {
      setOrganizationName(branding.organizationName || "");
      setHasInitialized(true);
    }
  }, [branding, hasInitialized]);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onCropComplete = useCallback((_croppedArea: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const uploadMutation = useMutation({
    mutationFn: async (file: Blob) => {
      const formData = new FormData();
      formData.append("logo", file, "logo.png");
      const res = await fetch("/api/admin/branding/logo", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/branding"] });
      setShowCropDialog(false);
      setImageSrc(null);
      toast({ title: "Logo uploaded successfully" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to upload logo", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/admin/branding/logo");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/branding"] });
      toast({ title: "Logo removed successfully" });
    },
    onError: () => {
      toast({ title: "Failed to remove logo", variant: "destructive" });
    },
  });

  const updateNameMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("PATCH", "/api/admin/branding", { organizationName: name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/branding"] });
      toast({ title: "Organization name updated" });
    },
    onError: () => {
      toast({ title: "Failed to update organization name", variant: "destructive" });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setImageSrc(reader.result as string);
        setShowCropDialog(true);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCropSave = async () => {
    if (imageSrc && croppedAreaPixels) {
      try {
        const croppedBlob = await getCroppedImg(imageSrc, croppedAreaPixels);
        uploadMutation.mutate(croppedBlob);
      } catch (error) {
        toast({ title: "Failed to crop image", variant: "destructive" });
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            Organization Logo
          </CardTitle>
          <CardDescription>
            Upload a square logo for your organization. It will appear in the app header and login page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-6">
            <div className="h-24 w-24 rounded-md border-2 border-dashed flex items-center justify-center bg-muted/50 overflow-hidden">
              {branding?.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt="Organization logo"
                  className="h-full w-full object-cover"
                  data-testid="img-current-logo"
                />
              ) : (
                <ImageIcon className="h-10 w-10 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleFileSelect}
                className="hidden"
                data-testid="input-logo-file"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-upload-logo"
              >
                <Upload className="h-4 w-4 mr-2" />
                {branding?.logoUrl ? "Change Logo" : "Upload Logo"}
              </Button>
              {branding?.logoUrl && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (confirm("Are you sure you want to remove the logo?")) {
                      deleteMutation.mutate();
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  data-testid="button-delete-logo"
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Remove Logo
                </Button>
              )}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Supported formats: JPEG, PNG, GIF, WebP. Max size: 10MB. The image will be cropped to a square.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organization Name</CardTitle>
          <CardDescription>
            Set a custom name to display in the app header
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Enter organization name"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              data-testid="input-organization-name"
            />
            <Button
              onClick={() => updateNameMutation.mutate(organizationName)}
              disabled={updateNameMutation.isPending}
              data-testid="button-save-name"
            >
              {updateNameMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showCropDialog} onOpenChange={(open) => {
        if (!open) {
          setShowCropDialog(false);
          setImageSrc(null);
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Crop Logo</DialogTitle>
            <DialogDescription>
              Adjust the crop area to create a square logo
            </DialogDescription>
          </DialogHeader>
          <div className="relative h-80 w-full bg-muted rounded-md overflow-hidden">
            {imageSrc && (
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            )}
          </div>
          <div className="flex items-center gap-4">
            <Label className="text-sm">Zoom</Label>
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1"
              data-testid="slider-zoom"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCropDialog(false);
                setImageSrc(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCropSave}
              disabled={uploadMutation.isPending}
              data-testid="button-save-crop"
            >
              {uploadMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Save Logo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface PlatformSettings {
  id: string;
  platform: "whatsapp" | "instagram" | "facebook";
  isConnected: boolean;
  accessToken: string | null;
  pageId: string | null;
  businessId: string | null;
  webhookVerifyToken: string | null;
  lastSyncAt: string | null;
}

function PlatformsTab({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const queryClient = useQueryClient();

  const { data: platforms = [], isLoading } = useQuery<PlatformSettings[]>({
    queryKey: ["/api/platform-settings"],
  });

  const [selectedPlatform, setSelectedPlatform] = useState<"facebook" | "instagram" | null>(null);
  const [formData, setFormData] = useState({
    accessToken: "",
    pageId: "",
    businessId: "",
    webhookVerifyToken: "",
  });

  const facebookSettings = platforms.find(p => p.platform === "facebook");
  const instagramSettings = platforms.find(p => p.platform === "instagram");

  const saveMutation = useMutation({
    mutationFn: async ({ platform, ...data }: { platform: string; accessToken: string; pageId: string; businessId: string; webhookVerifyToken: string }) => {
      const res = await apiRequest("POST", `/api/platform-settings/${platform}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform-settings"] });
      setSelectedPlatform(null);
      resetForm();
      toast({ title: "Platform settings saved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to save platform settings", variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (platform: string) => {
      const res = await apiRequest("POST", `/api/platform-settings/${platform}/test`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform-settings"] });
      if (data.success) {
        toast({ title: "Connection successful!", description: `Connected to ${JSON.stringify(data.details?.name || data.details?.username || "platform")}` });
      } else {
        toast({ title: "Connection failed", description: data.error, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Connection test failed", variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (platform: string) => {
      const res = await apiRequest("POST", `/api/platform-settings/${platform}/disconnect`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform-settings"] });
      toast({ title: "Platform disconnected" });
    },
    onError: () => {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (platform: string) => {
      const res = await apiRequest("POST", `/api/platform-settings/${platform}/sync`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      if (data.success) {
        toast({ 
          title: "Sync Complete", 
          description: `Synced ${data.syncedConversations} conversations and ${data.syncedMessages} messages.` 
        });
      } else {
        toast({ title: "Sync Failed", description: data.error, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to sync messages", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      accessToken: "",
      pageId: "",
      businessId: "",
      webhookVerifyToken: "",
    });
  };

  const openConfigDialog = (platform: "facebook" | "instagram") => {
    const settings = platform === "facebook" ? facebookSettings : instagramSettings;
    setFormData({
      accessToken: "", // Don't pre-populate token - user enters new one if changing
      pageId: settings?.pageId || "",
      businessId: settings?.businessId || "",
      webhookVerifyToken: settings?.webhookVerifyToken || "",
    });
    setSelectedPlatform(platform);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Messaging Platforms
          </CardTitle>
          <CardDescription>
            Connect your Facebook Messenger and Instagram to receive and send messages from this inbox.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground mb-4 p-4 bg-muted/50 rounded-md">
            <p className="font-medium mb-2">Webhook URL for Meta:</p>
            <code className="bg-background px-2 py-1 rounded text-xs break-all">
              {typeof window !== 'undefined' ? `${window.location.origin}/api/webhook/facebook` : '/api/webhook/facebook'}
            </code>
            <p className="text-xs mt-2">Use the same URL for both Facebook and Instagram webhooks. Replace "facebook" with "instagram" for Instagram-specific webhooks.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm">f</div>
                    Facebook Messenger
                  </CardTitle>
                  {facebookSettings?.isConnected ? (
                    <Badge className="bg-green-600">Connected</Badge>
                  ) : facebookSettings?.accessToken ? (
                    <Badge variant="outline">Configured</Badge>
                  ) : (
                    <Badge variant="secondary">Not Connected</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {facebookSettings?.accessToken ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Page ID: {facebookSettings.pageId || "Not set"}
                    </p>
                    {facebookSettings.lastSyncAt && (
                      <p className="text-xs text-muted-foreground">
                        Last synced: {new Date(facebookSettings.lastSyncAt).toLocaleString()}
                      </p>
                    )}
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => testMutation.mutate("facebook")}
                        disabled={testMutation.isPending}
                        data-testid="button-test-facebook"
                      >
                        {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                        Test
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openConfigDialog("facebook")}
                        data-testid="button-configure-facebook"
                      >
                        <Pencil className="h-4 w-4 mr-1" />
                        Configure
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm("Are you sure you want to disconnect Facebook?")) {
                            disconnectMutation.mutate("facebook");
                          }
                        }}
                        disabled={disconnectMutation.isPending}
                        data-testid="button-disconnect-facebook"
                      >
                        <Unlink className="h-4 w-4 mr-1" />
                        Disconnect
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => syncMutation.mutate("facebook")}
                        disabled={syncMutation.isPending || !facebookSettings?.isConnected}
                        data-testid="button-sync-facebook"
                      >
                        {syncMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
                        Sync
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Connect your Facebook Page to receive Messenger messages.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => openConfigDialog("facebook")}
                      data-testid="button-connect-facebook"
                    >
                      <Link2 className="h-4 w-4 mr-1" />
                      Connect Facebook
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">IG</div>
                    Instagram
                  </CardTitle>
                  {instagramSettings?.isConnected ? (
                    <Badge className="bg-green-600">Connected</Badge>
                  ) : instagramSettings?.accessToken ? (
                    <Badge variant="outline">Configured</Badge>
                  ) : (
                    <Badge variant="secondary">Not Connected</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {instagramSettings?.accessToken ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Business ID: {instagramSettings.businessId || "Not set"}
                    </p>
                    {instagramSettings.lastSyncAt && (
                      <p className="text-xs text-muted-foreground">
                        Last synced: {new Date(instagramSettings.lastSyncAt).toLocaleString()}
                      </p>
                    )}
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => testMutation.mutate("instagram")}
                        disabled={testMutation.isPending}
                        data-testid="button-test-instagram"
                      >
                        {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                        Test
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openConfigDialog("instagram")}
                        data-testid="button-configure-instagram"
                      >
                        <Pencil className="h-4 w-4 mr-1" />
                        Configure
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm("Are you sure you want to disconnect Instagram?")) {
                            disconnectMutation.mutate("instagram");
                          }
                        }}
                        disabled={disconnectMutation.isPending}
                        data-testid="button-disconnect-instagram"
                      >
                        <Unlink className="h-4 w-4 mr-1" />
                        Disconnect
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => syncMutation.mutate("instagram")}
                        disabled={syncMutation.isPending || !instagramSettings?.isConnected}
                        data-testid="button-sync-instagram"
                      >
                        {syncMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
                        Sync
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Connect your Instagram Business account to receive DMs.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => openConfigDialog("instagram")}
                      data-testid="button-connect-instagram"
                    >
                      <Link2 className="h-4 w-4 mr-1" />
                      Connect Instagram
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How to Get Your Credentials</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-4">
          <div>
            <p className="font-medium mb-2">1. Get a Page Access Token (Never-Expiring):</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground ml-2">
              <li>Go to <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener noreferrer" className="text-primary underline">Graph API Explorer</a></li>
              <li>Select your Facebook App and click "Get User Access Token"</li>
              <li>Select permissions: <code className="bg-muted px-1 rounded">pages_show_list</code>, <code className="bg-muted px-1 rounded">pages_messaging</code>, <code className="bg-muted px-1 rounded">instagram_basic</code>, <code className="bg-muted px-1 rounded">instagram_manage_messages</code></li>
              <li>Go to <a href="https://developers.facebook.com/tools/debug/accesstoken/" target="_blank" rel="noopener noreferrer" className="text-primary underline">Access Token Debugger</a> and click "Extend Access Token"</li>
              <li>Use the extended token to call: <code className="bg-muted px-1 rounded text-xs">GET /me/accounts</code> to get your never-expiring Page token</li>
            </ol>
          </div>
          <div>
            <p className="font-medium mb-2">2. Find Your Page ID:</p>
            <p className="text-muted-foreground ml-2">Your Page ID is returned in the <code className="bg-muted px-1 rounded">/me/accounts</code> response, or find it in your Facebook Page's About section.</p>
          </div>
          <div>
            <p className="font-medium mb-2">3. Find Your Instagram Business Account ID:</p>
            <p className="text-muted-foreground ml-2">Call <code className="bg-muted px-1 rounded text-xs">GET /{'{page_id}'}?fields=instagram_business_account</code> using your Page Access Token.</p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={selectedPlatform !== null} onOpenChange={(open) => !open && setSelectedPlatform(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Configure {selectedPlatform === "facebook" ? "Facebook Messenger" : "Instagram"}
            </DialogTitle>
            <DialogDescription>
              Enter your Meta API credentials to connect this platform.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="accessToken">Page Access Token {((selectedPlatform === "facebook" ? facebookSettings : instagramSettings)?.accessToken) ? "" : "*"}</Label>
              <Input
                id="accessToken"
                type="text"
                placeholder={((selectedPlatform === "facebook" ? facebookSettings : instagramSettings)?.accessToken) ? "Leave empty to keep existing token" : "Your page access token"}
                value={formData.accessToken}
                onChange={(e) => setFormData({ ...formData, accessToken: e.target.value })}
                className="font-mono text-sm"
                data-testid="input-access-token"
              />
            </div>
            {selectedPlatform === "facebook" && (
              <div className="space-y-2">
                <Label htmlFor="pageId">Page ID *</Label>
                <Input
                  id="pageId"
                  placeholder="Your Facebook Page ID"
                  value={formData.pageId}
                  onChange={(e) => setFormData({ ...formData, pageId: e.target.value })}
                  data-testid="input-page-id"
                />
              </div>
            )}
            {selectedPlatform === "instagram" && (
              <div className="space-y-2">
                <Label htmlFor="businessId">Instagram Business Account ID *</Label>
                <Input
                  id="businessId"
                  placeholder="Your Instagram Business Account ID"
                  value={formData.businessId}
                  onChange={(e) => setFormData({ ...formData, businessId: e.target.value })}
                  data-testid="input-business-id"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="webhookVerifyToken">Webhook Verify Token</Label>
              <Input
                id="webhookVerifyToken"
                placeholder="A secret token for webhook verification"
                value={formData.webhookVerifyToken}
                onChange={(e) => setFormData({ ...formData, webhookVerifyToken: e.target.value })}
                data-testid="input-verify-token"
              />
              <p className="text-xs text-muted-foreground">
                Create a random string and use it when configuring webhooks in Meta Developer Portal.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedPlatform(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedPlatform) {
                  saveMutation.mutate({
                    platform: selectedPlatform,
                    ...formData,
                  });
                }
              }}
              disabled={saveMutation.isPending || 
                // Require token only for new connections (no existing token)
                (!formData.accessToken && !((selectedPlatform === "facebook" ? facebookSettings : instagramSettings)?.accessToken)) || 
                (selectedPlatform === "facebook" && !formData.pageId) || 
                (selectedPlatform === "instagram" && !formData.businessId)}
              data-testid="button-save-platform"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ApiClient {
  id: string;
  name: string;
  clientId: string;
  isActive: boolean;
  aiPrompt: string | null;
  ipWhitelist: string[] | null;
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  createdAt: Date;
  lastRequestAt: Date | null;
  requestCountToday: number;
}

interface ApiClientWithSecret extends ApiClient {
  secretKey?: string;
}

function ApiClientsTab({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingClient, setEditingClient] = useState<ApiClient | null>(null);
  const [newSecret, setNewSecret] = useState<{ clientId: string; secret: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  
  const [formData, setFormData] = useState({
    name: "",
    aiPrompt: "",
    ipWhitelist: "",
    rateLimitPerMinute: 60,
    rateLimitPerDay: 1000,
    isActive: true,
  });

  const { data: apiClients = [], isLoading } = useQuery<ApiClient[]>({
    queryKey: ["/api/admin/api-clients"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; aiPrompt?: string; ipWhitelist?: string[]; rateLimitPerMinute?: number; rateLimitPerDay?: number }) => {
      const res = await apiRequest("POST", "/api/admin/api-clients", data);
      return res.json();
    },
    onSuccess: (data: ApiClientWithSecret) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-clients"] });
      setShowCreateDialog(false);
      setNewSecret({ clientId: data.clientId, secret: data.secretKey || "" });
      setFormData({ name: "", aiPrompt: "", ipWhitelist: "", rateLimitPerMinute: 60, rateLimitPerDay: 1000, isActive: true });
      toast({ title: "API client created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create API client", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; aiPrompt?: string | null; ipWhitelist?: string[] | null; rateLimitPerMinute?: number; rateLimitPerDay?: number; isActive?: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/api-clients/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-clients"] });
      setEditingClient(null);
      toast({ title: "API client updated" });
    },
    onError: () => {
      toast({ title: "Failed to update API client", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/api-clients/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-clients"] });
      toast({ title: "API client deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete API client", variant: "destructive" });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/api-clients/${id}/regenerate-secret`);
      return res.json();
    },
    onSuccess: (data: { clientId: string; secretKey: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-clients"] });
      setNewSecret({ clientId: data.clientId, secret: data.secretKey });
      toast({ title: "API secret regenerated" });
    },
    onError: () => {
      toast({ title: "Failed to regenerate secret", variant: "destructive" });
    },
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied to clipboard` });
  };

  const handleCreate = () => {
    const ipWhitelist = formData.ipWhitelist.trim()
      ? formData.ipWhitelist.split(",").map(ip => ip.trim()).filter(ip => ip)
      : undefined;
    createMutation.mutate({
      name: formData.name,
      aiPrompt: formData.aiPrompt.trim() || undefined,
      ipWhitelist,
      rateLimitPerMinute: formData.rateLimitPerMinute,
      rateLimitPerDay: formData.rateLimitPerDay,
    });
  };

  const handleUpdate = () => {
    if (!editingClient) return;
    const ipWhitelist = formData.ipWhitelist.trim()
      ? formData.ipWhitelist.split(",").map(ip => ip.trim()).filter(ip => ip)
      : null;
    updateMutation.mutate({
      id: editingClient.id,
      name: formData.name,
      aiPrompt: formData.aiPrompt.trim() || null,
      ipWhitelist,
      rateLimitPerMinute: formData.rateLimitPerMinute,
      rateLimitPerDay: formData.rateLimitPerDay,
      isActive: formData.isActive,
    });
  };

  const openEditDialog = (client: ApiClient) => {
    setFormData({
      name: client.name,
      aiPrompt: client.aiPrompt || "",
      ipWhitelist: client.ipWhitelist?.join(", ") || "",
      rateLimitPerMinute: client.rateLimitPerMinute,
      rateLimitPerDay: client.rateLimitPerDay,
      isActive: client.isActive,
    });
    setEditingClient(client);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>External API Clients</CardTitle>
              <CardDescription>Manage API keys for external applications to send WhatsApp messages through OmniDesk</CardDescription>
            </div>
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
              <DialogTrigger asChild>
                <Button data-testid="button-create-api-client">
                  <Plus className="h-4 w-4 mr-2" />
                  Create API Client
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create API Client</DialogTitle>
                  <DialogDescription>Create a new API client for external applications</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Client Name *</Label>
                    <Input
                      id="name"
                      placeholder="e.g. My CRM System"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      data-testid="input-api-client-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="aiPrompt">AI Prompt (for message personalization)</Label>
                    <Textarea
                      id="aiPrompt"
                      placeholder="e.g. You are a friendly customer service assistant for {{company}}. Greet the customer by name ({{recipient_name}}) and personalize the message..."
                      value={formData.aiPrompt}
                      onChange={(e) => setFormData({ ...formData, aiPrompt: e.target.value })}
                      rows={4}
                      data-testid="input-api-ai-prompt"
                    />
                    <p className="text-xs text-muted-foreground">Use {"{{recipient_name}}"} to insert the recipient's name in the prompt</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ipWhitelist">Allowed IP Addresses (comma-separated, leave empty for any)</Label>
                    <Input
                      id="ipWhitelist"
                      placeholder="e.g. 192.168.1.1, 10.0.0.1"
                      value={formData.ipWhitelist}
                      onChange={(e) => setFormData({ ...formData, ipWhitelist: e.target.value })}
                      data-testid="input-api-allowed-ips"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="rateLimitPerMinute">Rate Limit (per minute)</Label>
                      <Input
                        id="rateLimitPerMinute"
                        type="number"
                        min={1}
                        value={formData.rateLimitPerMinute}
                        onChange={(e) => setFormData({ ...formData, rateLimitPerMinute: parseInt(e.target.value) || 60 })}
                        data-testid="input-api-rate-limit"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rateLimitPerDay">Daily Limit</Label>
                      <Input
                        id="rateLimitPerDay"
                        type="number"
                        min={1}
                        value={formData.rateLimitPerDay}
                        onChange={(e) => setFormData({ ...formData, rateLimitPerDay: parseInt(e.target.value) || 1000 })}
                        data-testid="input-api-daily-limit"
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
                  <Button onClick={handleCreate} disabled={createMutation.isPending || !formData.name.trim()} data-testid="button-confirm-create-api-client">
                    {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : apiClients.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Key className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No API clients configured</p>
              <p className="text-sm">Create an API client to allow external applications to send messages</p>
            </div>
          ) : (
            <div className="space-y-4">
              {apiClients.map((client) => (
                <Card key={client.id} className={!client.isActive ? "opacity-60" : ""}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold">{client.name}</h3>
                          {client.isActive ? (
                            <Badge variant="default" className="bg-green-600">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{client.clientId}</code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => copyToClipboard(client.clientId, "Client ID")}
                            data-testid={`button-copy-client-id-${client.id}`}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <p>Rate limit: {client.rateLimitPerMinute}/min | Daily: {client.rateLimitPerDay}</p>
                          <p>Today: {client.requestCountToday} requests</p>
                          {client.ipWhitelist && client.ipWhitelist.length > 0 && (
                            <p>Allowed IPs: {client.ipWhitelist.join(", ")}</p>
                          )}
                          {client.lastRequestAt && (
                            <p>Last used: {new Date(client.lastRequestAt).toLocaleString()}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (confirm("Regenerating the secret will invalidate the current one. Continue?")) {
                              regenerateMutation.mutate(client.id);
                            }
                          }}
                          disabled={regenerateMutation.isPending}
                          data-testid={`button-regenerate-secret-${client.id}`}
                        >
                          <RefreshCw className="h-4 w-4 mr-1" />
                          Regenerate Secret
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(client)}
                          data-testid={`button-edit-api-client-${client.id}`}
                        >
                          <Pencil className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Delete API client "${client.name}"?`)) {
                              deleteMutation.mutate(client.id);
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-api-client-${client.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">API Documentation</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-4">
          <div>
            <p className="font-medium mb-2">Authentication:</p>
            <p className="text-muted-foreground mb-2">All requests must include HMAC signature headers:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
              <li><code className="bg-muted px-1 rounded">X-Client-Id</code>: Your client ID</li>
              <li><code className="bg-muted px-1 rounded">X-Timestamp</code>: Unix timestamp in milliseconds</li>
              <li><code className="bg-muted px-1 rounded">X-Signature</code>: HMAC-SHA256 signature (hex)</li>
            </ul>
            <div className="mt-3 p-2 bg-muted rounded text-xs">
              <p className="font-medium mb-1">Signature Calculation:</p>
              <code>message = clientId + "." + timestamp + "." + requestBody</code><br/>
              <code>signature = HMAC-SHA256(message, secretKey).toHex()</code>
              <p className="mt-2 text-muted-foreground">Note: For POST requests, sign the exact raw JSON body you send. For GET requests (no body), use an empty string for requestBody.</p>
            </div>
          </div>
          <Separator />
          <div>
            <p className="font-medium mb-2">Send Single Message:</p>
            <code className="block bg-muted p-2 rounded text-xs">POST /api/external/messages</code>
            <pre className="bg-muted p-2 rounded text-xs mt-2 overflow-x-auto">{`{
  "request_id": "unique-id-123",
  "phone_number": "628123456789",
  "recipient_name": "John Doe",
  "message": "Hello from my app!",
  "priority": 0,
  "scheduled_at": "2024-01-15T10:00:00Z",
  "metadata": { "order_id": "12345" }
}`}</pre>
            <div className="mt-2 text-xs text-muted-foreground">
              <p className="font-medium">Fields:</p>
              <ul className="list-disc list-inside ml-2 space-y-1">
                <li><code className="bg-muted px-1 rounded">request_id</code> (required): Unique ID to prevent duplicates</li>
                <li><code className="bg-muted px-1 rounded">phone_number</code> (required): Recipient phone number</li>
                <li><code className="bg-muted px-1 rounded">recipient_name</code> (optional): Name for AI personalization</li>
                <li><code className="bg-muted px-1 rounded">message</code> (required): Message content</li>
                <li><code className="bg-muted px-1 rounded">priority</code> (optional): 0-100, higher = sent first</li>
                <li><code className="bg-muted px-1 rounded">scheduled_at</code> (optional): ISO datetime to schedule</li>
                <li><code className="bg-muted px-1 rounded">metadata</code> (optional): Custom JSON data</li>
              </ul>
            </div>
          </div>
          <div>
            <p className="font-medium mb-2">Send Bulk Messages:</p>
            <code className="block bg-muted p-2 rounded text-xs">POST /api/external/messages/bulk</code>
            <pre className="bg-muted p-2 rounded text-xs mt-2 overflow-x-auto">{`{
  "messages": [
    { "request_id": "msg-1", "phone_number": "628123456789", "recipient_name": "Alice", "message": "Hello Alice!" },
    { "request_id": "msg-2", "phone_number": "628987654321", "recipient_name": "Bob", "message": "Hello Bob!" }
  ]
}`}</pre>
          </div>
          <div>
            <p className="font-medium mb-2">Check Message Status:</p>
            <code className="block bg-muted p-2 rounded text-xs">GET /api/external/messages/:message_id</code>
          </div>
          <div>
            <p className="font-medium mb-2">Get Client Status:</p>
            <code className="block bg-muted p-2 rounded text-xs">GET /api/external/status</code>
          </div>
          <Separator />
          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md mb-3">
            <p className="font-medium text-blue-600 dark:text-blue-400">AI Personalization:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 mt-2">
              <li>Each API client can have a custom AI prompt for message personalization</li>
              <li>Include <code className="bg-muted px-1 rounded">recipient_name</code> in your API request</li>
              <li>Use <code className="bg-muted px-1 rounded">{"{{recipient_name}}"}</code> in your AI prompt to reference the name</li>
              <li>The AI will use the client's prompt to personalize messages automatically</li>
            </ul>
          </div>
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
            <p className="font-medium text-yellow-600 dark:text-yellow-500">Important Notes:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 mt-2">
              <li>Messages are queued and sent with 2-3 minute delays to avoid WhatsApp bans</li>
              <li>Messages are only sent between 7 AM - 9 PM (Jakarta time)</li>
              <li>Duplicate request_ids are rejected to prevent double-sends</li>
              <li>IP whitelist uses Cloudflare's CF-Connecting-IP header</li>
              <li>Rate limit headers (X-RateLimit-*) are included in responses</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Dialog open={editingClient !== null} onOpenChange={(open) => !open && setEditingClient(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit API Client</DialogTitle>
            <DialogDescription>Update API client settings</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editName">Client Name *</Label>
              <Input
                id="editName"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                data-testid="input-edit-api-client-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editAiPrompt">AI Prompt (for message personalization)</Label>
              <Textarea
                id="editAiPrompt"
                placeholder="e.g. You are a friendly customer service assistant..."
                value={formData.aiPrompt}
                onChange={(e) => setFormData({ ...formData, aiPrompt: e.target.value })}
                rows={4}
                data-testid="input-edit-api-ai-prompt"
              />
              <p className="text-xs text-muted-foreground">Use {"{{recipient_name}}"} to insert the recipient's name</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editIpWhitelist">Allowed IP Addresses</Label>
              <Input
                id="editIpWhitelist"
                placeholder="e.g. 192.168.1.1, 10.0.0.1"
                value={formData.ipWhitelist}
                onChange={(e) => setFormData({ ...formData, ipWhitelist: e.target.value })}
                data-testid="input-edit-api-allowed-ips"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editRateLimitPerMinute">Rate Limit (per minute)</Label>
                <Input
                  id="editRateLimitPerMinute"
                  type="number"
                  min={1}
                  value={formData.rateLimitPerMinute}
                  onChange={(e) => setFormData({ ...formData, rateLimitPerMinute: parseInt(e.target.value) || 60 })}
                  data-testid="input-edit-api-rate-limit"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editRateLimitPerDay">Daily Limit</Label>
                <Input
                  id="editRateLimitPerDay"
                  type="number"
                  min={1}
                  value={formData.rateLimitPerDay}
                  onChange={(e) => setFormData({ ...formData, rateLimitPerDay: parseInt(e.target.value) || 1000 })}
                  data-testid="input-edit-api-daily-limit"
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                data-testid="switch-api-client-active"
              />
              <Label htmlFor="isActive">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingClient(null)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending || !formData.name.trim()} data-testid="button-confirm-edit-api-client">
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newSecret !== null} onOpenChange={(open) => !open && setNewSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              API Credentials
            </DialogTitle>
            <DialogDescription>
              Save these credentials now. The secret key will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Client ID</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted p-2 rounded font-mono text-sm break-all">{newSecret?.clientId}</code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(newSecret?.clientId || "", "Client ID")}
                  data-testid="button-copy-new-client-id"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Secret Key</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted p-2 rounded font-mono text-sm break-all">
                  {showSecret ? newSecret?.secret : "••••••••••••••••••••••••••••••••"}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowSecret(!showSecret)}
                  data-testid="button-toggle-secret-visibility"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(newSecret?.secret || "", "Secret Key")}
                  data-testid="button-copy-new-secret"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
              <p className="text-sm text-yellow-600 dark:text-yellow-500">
                Store the secret key securely. It cannot be retrieved after closing this dialog.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setNewSecret(null); setShowSecret(false); }} data-testid="button-close-credentials">
              I've saved these credentials
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
