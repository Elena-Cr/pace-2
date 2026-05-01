-- Attach handle_new_user to auth.users so signup creates profile/user_profile/role rows
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill any existing auth users that are missing rows
INSERT INTO public.profiles (id, display_name)
SELECT u.id, COALESCE(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1), 'Friend')
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

INSERT INTO public.user_profiles (user_id)
SELECT u.id FROM auth.users u
LEFT JOIN public.user_profiles up ON up.user_id = u.id
WHERE up.user_id IS NULL;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'user'::app_role FROM auth.users u
LEFT JOIN public.user_roles r ON r.user_id = u.id
WHERE r.user_id IS NULL;