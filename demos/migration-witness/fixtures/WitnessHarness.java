import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class WitnessHarness {
    public static void main(String[] args) throws Exception {
        Class<?> implementation = Class.forName(args[0]);
        boolean candidate = Boolean.parseBoolean(args[2]);
        boolean sharedBug = Boolean.parseBoolean(args[3]);
        int count = 0, failed = 0;
        List<String> lines = Files.readAllLines(Path.of(args[1]), StandardCharsets.UTF_8);
        for (String line : lines.subList(1, lines.size())) {
            String[] row = line.split("\t", -1);
            String expected = row[candidate ? 5 : 4];
            String actual = (String) implementation.getMethod("render", String.class, String.class, String.class, boolean.class)
                .invoke(null, row[1], row[2], row[3], sharedBug);
            boolean pass = expected.equals(actual);
            count++; if (!pass) failed++;
            System.out.println("ASSERT\t" + row[0] + "\t" + (pass ? "PASS" : "FAIL") + "\t" + Base64.getEncoder().encodeToString(actual.getBytes(StandardCharsets.UTF_8)));
        }
        System.out.println("SUMMARY\t" + count + "\t" + failed);
        System.exit(failed == 0 ? 0 : 1);
    }
}
